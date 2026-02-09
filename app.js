(() => {
  "use strict";

  const C = window.APP_CONFIG;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = String(t ?? "-"); };
  const setStatus = (t) => { const el = $("status"); if (el) el.textContent = t; };

  const shortAddr = (a) => a ? (a.slice(0, 6) + "..." + a.slice(-4)) : "-";
  const fmtDate = (sec) => {
    try { return new Date(Number(sec) * 1000).toLocaleString(); } catch { return "-"; }
  };
  const fmtDur = (sec) => {
    sec = Number(sec);
    if (!isFinite(sec) || sec <= 0) return "00:00:00";
    const d = Math.floor(sec / 86400);
    sec -= d * 86400;
    const h = Math.floor(sec / 3600);
    sec -= h * 3600;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec - m * 60);
    const pad = (n) => String(n).padStart(2, "0");
    return (d > 0 ? `${d}d ` : "") + `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  // ---------- ABIs ----------
  const ERC20_ABI = [
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
    "function decimals() view returns(uint8)",
    "function symbol() view returns(string)"
  ];

  // Contract ABI (เฉพาะที่ใช้)
  const STAKING_ABI = [
    "function owner() view returns(address)",
    "function STCEx() view returns(address)",
    "function STC() view returns(address)",
    "function stcPerStcex() view returns(uint256)",
    "function minStakeSTCEx() view returns(uint256)",
    "function lockSeconds() view returns(uint256)",
    "function periodSeconds() view returns(uint256)",
    "function rewardBps() view returns(uint256)",
    "function positionsCount(address) view returns(uint256)",
    "function getPosition(address,uint256) view returns(uint256 principalSTC,uint256 startTime,bool withdrawn)",
    "function unlockAt(address,uint256) view returns(uint256)",
    "function timeUntilUnlock(address,uint256) view returns(uint256)",
    "function accruedRewardSTC(address,uint256) view returns(uint256 reward,uint256 periods)",
    "function matured(address,uint256) view returns(bool)",
    "function stakeWithSTCEx(uint256) external",
    "function withdrawPosition(uint256) external",
  ];

  // ---------- State ----------
  let provider, signer, user;
  let staking, stcex, stc;
  let stcexDec = 18, stcDec = 18;
  let isOwner = false;

  let timer = null;

  // ---------- Owner-only visibility ----------
  function applyOwnerVisibility(isOwnerFlag) {
    const paramsCard = $("paramsCard");
    const posHelp = document.querySelector(".pos-help");
    if (!isOwnerFlag) {
      if (paramsCard) paramsCard.style.display = "none";
      if (posHelp) posHelp.style.display = "none";
    } else {
      if (paramsCard) paramsCard.style.display = "block";
      if (posHelp) posHelp.style.display = "block";
    }
  }

  // ---------- Connect ----------
  async function connect() {
    try {
      if (!window.ethereum) throw new Error("ไม่พบกระเป๋า (MetaMask/Bitget)");
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      user = await signer.getAddress();

      setText("wallet", shortAddr(user));
      setText("contract", C.CONTRACT);

      $("linkContract").href = `${C.BLOCK_EXPLORER}/address/${C.CONTRACT}`;
      $("linkWallet").href = `${C.BLOCK_EXPLORER}/address/${user}`;

      // chain check (optional)
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== C.CHAIN_ID_DEC) {
        setStatus(`⚠️ กรุณาสลับเครือข่ายเป็น BSC (56) ก่อน`);
      } else {
        setStatus(`✅ เชื่อมต่อสำเร็จ`);
      }

      staking = new ethers.Contract(C.CONTRACT, STAKING_ABI, signer);

      // tokens (use config)
      stcex = new ethers.Contract(C.STCEX, ERC20_ABI, signer);
      stc   = new ethers.Contract(C.STC,   ERC20_ABI, signer);

      // decimals
      try { stcexDec = Number(await stcex.decimals()); } catch {}
      try { stcDec   = Number(await stc.decimals()); } catch {}

      // owner check
      const ownerAddr = await staking.owner();
      setText("owner", shortAddr(ownerAddr));
      isOwner = ownerAddr.toLowerCase() === user.toLowerCase();
      setText("isOwner", isOwner ? "YES" : "NO");
      $("isOwner").className = "mono " + (isOwner ? "ok" : "no");

      applyOwnerVisibility(isOwner);

      // enable buttons
      $("btnRefresh").disabled = false;
      $("btnApprove").disabled = false;
      $("btnStake").disabled = false;

      // load
      await refreshAll();

      // auto refresh table countdown
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        // refresh only countdown values without spamming RPC
        updateCountdownCells();
      }, 1000);

    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.message || e}`);
    }
  }

  // ---------- Read helpers ----------
  function parseInputAmount(id, dec) {
    const v = ($(id).value || "").trim().replace(/,/g, "");
    if (!v) throw new Error("กรุณากรอกจำนวน");
    return ethers.parseUnits(v, dec);
  }

  async function refreshBalances() {
    if (!user) return;
    const [b1, b2, alw] = await Promise.all([
      stcex.balanceOf(user),
      stc.balanceOf(user),
      stcex.allowance(user, C.CONTRACT),
    ]);
    setText("balSTCEx", ethers.formatUnits(b1, stcexDec));
    setText("balSTC",   ethers.formatUnits(b2, stcDec));
    setText("allowSTCEx", ethers.formatUnits(alw, stcexDec));
  }

  async function refreshParamsIfOwnerOrHiddenOk() {
    // เราเติมข้อมูลไว้เหมือนเดิม แต่ user จะไม่เห็นเพราะซ่อน element ไปแล้ว
    const [p1, p2, p3, p4, p5] = await Promise.all([
      staking.stcPerStcex(),
      staking.minStakeSTCEx(),
      staking.lockSeconds(),
      staking.periodSeconds(),
      staking.rewardBps(),
    ]);
    setText("p1", p1.toString());
    setText("p2", p2.toString());
    setText("p3", p3.toString());
    setText("p4", p4.toString());
    setText("p5", p5.toString());

    // contract balances
    const [c1, c2] = await Promise.all([
      stc.balanceOf(C.CONTRACT),
      stcex.balanceOf(C.CONTRACT),
    ]);
    setText("cSTC", ethers.formatUnits(c1, stcDec));
    setText("cSTCEx", ethers.formatUnits(c2, stcexDec));
  }

  // Store countdown seconds per posId in DOM dataset
  function setRowCountdown(posId, seconds) {
    const el = document.querySelector(`[data-posid="${posId}"][data-col="countdown"]`);
    if (!el) return;
    el.dataset.left = String(Math.max(0, Number(seconds) || 0));
    el.textContent = fmtDur(el.dataset.left);
  }

  function updateCountdownCells() {
    const cells = document.querySelectorAll(`[data-col="countdown"][data-posid]`);
    for (const el of cells) {
      const left = Math.max(0, (Number(el.dataset.left) || 0) - 1);
      el.dataset.left = String(left);
      el.textContent = fmtDur(left);
      // update status badge
      const st = document.querySelector(`[data-posid="${el.dataset.posid}"][data-col="status"]`);
      if (st && left === 0) {
        st.textContent = "MATURED";
        st.className = "ok";
      }
      // enable withdraw button when matured
      const btn = document.querySelector(`[data-posid="${el.dataset.posid}"][data-col="withdrawbtn"]`);
      if (btn && left === 0) btn.disabled = false;
    }
  }

  async function refreshPositions() {
    if (!user) return;

    const count = Number(await staking.positionsCount(user));
    setText("posCount", count);

    const tbody = $("posTbody");
    tbody.innerHTML = "";

    if (count === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">ยังไม่มี position</td></tr>`;
      return;
    }

    // load in parallel but keep reasonable
    for (let i = 0; i < count; i++) {
      const posId = i;

      const [
        pos,
        unlockAt,
        ttu,
        ar,
        matured
      ] = await Promise.all([
        staking.getPosition(user, posId),
        staking.unlockAt(user, posId),
        staking.timeUntilUnlock(user, posId),
        staking.accruedRewardSTC(user, posId),
        staking.matured(user, posId),
      ]);

      const principal = pos.principalSTC;
      const startTime = pos.startTime;
      const withdrawn = pos.withdrawn;

      const reward = ar.reward;
      const periods = ar.periods;

      const left = Number(ttu);

      const statusText = withdrawn ? "WITHDRAWN" : (matured ? "MATURED" : "LOCKED");
      const statusClass = withdrawn ? "no" : (matured ? "ok" : "warn");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${posId}</td>
        <td class="mono">${ethers.formatUnits(principal, stcDec)}</td>
        <td class="mono">${fmtDate(startTime)}</td>
        <td class="mono">${fmtDate(unlockAt)}</td>
        <td class="mono" data-posid="${posId}" data-col="countdown" data-left="${left}">${fmtDur(left)}</td>
        <td class="mono">${periods.toString()}</td>
        <td class="mono">${ethers.formatUnits(reward, stcDec)}</td>
        <td class="${statusClass}" data-posid="${posId}" data-col="status">${statusText}</td>
        <td>
          <button class="smallbtn" data-posid="${posId}" data-col="withdrawbtn" ${(!matured || withdrawn) ? "disabled" : ""}>
            Withdraw
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // bind withdraw buttons
    tbody.querySelectorAll(`button[data-col="withdrawbtn"]`).forEach(btn => {
      btn.addEventListener("click", async () => {
        const posId = Number(btn.dataset.posid);
        await withdrawPosition(posId);
      });
    });
  }

  async function refreshAll() {
    try {
      $("btnRefresh").disabled = true;
      await Promise.all([
        refreshBalances(),
        refreshParamsIfOwnerOrHiddenOk(),
      ]);
      await refreshPositions();
      $("btnRefresh").disabled = false;
    } catch (e) {
      console.error(e);
      $("btnRefresh").disabled = false;
      setStatus(`❌ Refresh error: ${e?.message || e}`);
    }
  }

  // ---------- Actions ----------
  async function approveSTCEx() {
    try {
      const amt = parseInputAmount("inStake", stcexDec);
      if (amt <= 0n) throw new Error("จำนวนต้องมากกว่า 0");

      setStatus("⏳ กำลัง Approve STCEx...");
      $("btnApprove").disabled = true;

      // approve exact amount (หรือคุณจะปรับเป็น MaxUint256 ก็ได้)
      const tx = await stcex.approve(C.CONTRACT, amt);
      await tx.wait();

      setStatus("✅ Approve สำเร็จ");
      await refreshBalances();
    } catch (e) {
      console.error(e);
      setStatus(`❌ Approve failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      $("btnApprove").disabled = false;
    }
  }

  async function stake() {
    try {
      const amt = parseInputAmount("inStake", stcexDec);
      if (amt <= 0n) throw new Error("จำนวนต้องมากกว่า 0");

      const minStake = await staking.minStakeSTCEx();
      if (amt < minStake) {
        throw new Error(`ขั้นต่ำต้องไม่น้อยกว่า ${ethers.formatUnits(minStake, stcexDec)} STCEx`);
      }

      // check allowance
      const alw = await stcex.allowance(user, C.CONTRACT);
      if (alw < amt) throw new Error("Allowance ไม่พอ กรุณากด Approve ก่อน");

      setStatus("⏳ กำลัง Stake...");
      $("btnStake").disabled = true;

      const tx = await staking.stakeWithSTCEx(amt);
      await tx.wait();

      setStatus("✅ Stake สำเร็จ (สร้างก้อนใหม่)");
      $("inStake").value = "";
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`❌ Stake failed: ${e?.shortMessage || e?.message || e}`);
    } finally {
      $("btnStake").disabled = false;
    }
  }

  async function withdrawPosition(posId) {
    try {
      setStatus(`⏳ กำลัง Withdraw posId ${posId}...`);
      const tx = await staking.withdrawPosition(posId);
      await tx.wait();
      setStatus(`✅ Withdraw posId ${posId} สำเร็จ`);
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`❌ Withdraw failed: ${e?.shortMessage || e?.message || e}`);
    }
  }

  // ---------- UI bind ----------
  function bindUI() {
    $("btnConnect").addEventListener("click", connect);
    $("btnRefresh").addEventListener("click", refreshAll);
    $("btnApprove").addEventListener("click", approveSTCEx);
    $("btnStake").addEventListener("click", stake);

    // show contract address immediately
    setText("contract", C.CONTRACT);
    $("linkContract").href = `${C.BLOCK_EXPLORER}/address/${C.CONTRACT}`;
  }

  bindUI();
})();
