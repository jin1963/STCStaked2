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
    const d = Math.floor(sec / 86400); sec -= d * 86400;
    const h = Math.floor(sec / 3600);  sec -= h * 3600;
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
    "function symbol() view returns(string)",
    "function name() view returns(string)"
  ];

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
  let readProvider;

  // signer contracts (tx)
  let staking, stcex, stc;

  // read-only contracts (calls)
  let stakingR, stcexR, stcR;

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

  // ---------- Token add to wallet ----------
  async function addTokenToWallet(tokenAddress) {
    if (!window.ethereum) throw new Error("ไม่พบกระเป๋า");
    // ใช้ readProvider อ่าน name/symbol/decimals ให้แม่น (กัน Bitget call error)
    const t = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider || provider);
    let decimals = 18, symbol = "TOKEN", name = "Token";
    try { decimals = Number(await t.decimals()); } catch {}
    try { symbol = await t.symbol(); } catch {}
    try { name = await t.name(); } catch {}

    await window.ethereum.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: { address: tokenAddress, symbol, decimals, name }
      }
    });
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

      $("linkContract").href = `${C.EXPLORER}/address/${C.CONTRACT}`;
      $("linkWallet").href = `${C.EXPLORER}/address/${user}`;

      // chain check
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== Number(C.CHAIN_ID_DEC)) {
        setStatus(`⚠️ กรุณาสลับเครือข่ายเป็น ${C.CHAIN_NAME} (${C.CHAIN_ID_DEC})`);
      } else {
        setStatus(`✅ เชื่อมต่อสำเร็จ`);
      }

      // ✅ Read provider (แก้ Bitget อ่านค่าไม่ขึ้น)
      readProvider = new ethers.JsonRpcProvider(C.RPC_URL);

      // signer contracts (tx)
      staking = new ethers.Contract(C.CONTRACT, STAKING_ABI, signer);
      stcex   = new ethers.Contract(C.STCEX, ERC20_ABI, signer);
      stc     = new ethers.Contract(C.STC,   ERC20_ABI, signer);

      // read-only contracts (calls)
      stakingR = new ethers.Contract(C.CONTRACT, STAKING_ABI, readProvider);
      stcexR   = new ethers.Contract(C.STCEX, ERC20_ABI, readProvider);
      stcR     = new ethers.Contract(C.STC,   ERC20_ABI, readProvider);

      // decimals (อ่านจาก RPC ตรง)
      try { stcexDec = Number(await stcexR.decimals()); } catch {}
      try { stcDec   = Number(await stcR.decimals()); } catch {}

      // owner check (อ่านจาก RPC ตรง)
      const ownerAddr = await stakingR.owner();
      setText("owner", shortAddr(ownerAddr));
      isOwner = ownerAddr.toLowerCase() === user.toLowerCase();
      setText("isOwner", isOwner ? "YES" : "NO");
      $("isOwner").className = "mono " + (isOwner ? "ok" : "no");

      // ✅ ซ่อนสำหรับ user
      applyOwnerVisibility(isOwner);

      // enable buttons
      $("btnRefresh").disabled = false;
      $("btnApprove").disabled = false;
      $("btnStake").disabled = false;
      $("btnAddSTCEx").disabled = false;
      $("btnAddSTC").disabled = false;

      // initial load
      await refreshAll();

      // countdown timer
      if (timer) clearInterval(timer);
      timer = setInterval(updateCountdownCells, 1000);

    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.message || e}`);
    }
  }

  // ---------- Helpers ----------
  function parseInputAmount(id, dec) {
    const v = ($(id).value || "").trim().replace(/,/g, "");
    if (!v) throw new Error("กรุณากรอกจำนวน");
    return ethers.parseUnits(v, dec);
  }

  async function refreshBalances() {
    if (!user) return;
    const [b1, b2, alw] = await Promise.all([
      stcexR.balanceOf(user),
      stcR.balanceOf(user),
      stcexR.allowance(user, C.CONTRACT),
    ]);
    setText("balSTCEx", ethers.formatUnits(b1, stcexDec));
    setText("balSTC",   ethers.formatUnits(b2, stcDec));
    setText("allowSTCEx", ethers.formatUnits(alw, stcexDec));
  }

  async function refreshParams() {
    // เติมไว้เหมือนเดิม แต่ user จะไม่เห็นเพราะซ่อน card
    const [p1, p2, p3, p4, p5] = await Promise.all([
      stakingR.stcPerStcex(),
      stakingR.minStakeSTCEx(),
      stakingR.lockSeconds(),
      stakingR.periodSeconds(),
      stakingR.rewardBps(),
    ]);
    setText("p1", p1.toString());
    setText("p2", p2.toString());
    setText("p3", p3.toString());
    setText("p4", p4.toString());
    setText("p5", p5.toString());

    const [c1, c2] = await Promise.all([
      stcR.balanceOf(C.CONTRACT),
      stcexR.balanceOf(C.CONTRACT),
    ]);
    setText("cSTC", ethers.formatUnits(c1, stcDec));
    setText("cSTCEx", ethers.formatUnits(c2, stcexDec));
  }

  // countdown in DOM dataset
  function updateCountdownCells() {
    const cells = document.querySelectorAll(`[data-col="countdown"][data-posid]`);
    for (const el of cells) {
      const left = Math.max(0, (Number(el.dataset.left) || 0) - 1);
      el.dataset.left = String(left);
      el.textContent = fmtDur(left);

      const st = document.querySelector(`[data-posid="${el.dataset.posid}"][data-col="status"]`);
      if (st && left === 0) {
        st.textContent = "MATURED";
        st.className = "ok";
      }

      const btn = document.querySelector(`[data-posid="${el.dataset.posid}"][data-col="withdrawbtn"]`);
      if (btn && left === 0) btn.disabled = false;
    }
  }

  async function refreshPositions() {
    if (!user) return;

    const count = Number(await stakingR.positionsCount(user));
    setText("posCount", count);

    const tbody = $("posTbody");
    tbody.innerHTML = "";

    if (count === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">ยังไม่มี position</td></tr>`;
      return;
    }

    for (let posId = 0; posId < count; posId++) {
      const [pos, unlockAt, ttu, ar, matured] = await Promise.all([
        stakingR.getPosition(user, posId),
        stakingR.unlockAt(user, posId),
        stakingR.timeUntilUnlock(user, posId),
        stakingR.accruedRewardSTC(user, posId),
        stakingR.matured(user, posId),
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
      await Promise.all([refreshBalances(), refreshParams()]);
      await refreshPositions();
      $("btnRefresh").disabled = false;
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.message || e}`);
      $("btnRefresh").disabled = false;
    }
  }

  // ---------- Actions ----------
  async function approveSTCEx() {
    try {
      if (!user) throw new Error("กรุณาเชื่อมต่อกระเป๋า");
      const amt = parseInputAmount("inStake", stcexDec);

      setStatus("⏳ กำลัง Approve STCEx...");
      const tx = await stcex.approve(C.CONTRACT, amt);
      await tx.wait();

      setStatus("✅ Approve สำเร็จ");
      await refreshBalances();
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function stake() {
    try {
      if (!user) throw new Error("กรุณาเชื่อมต่อกระเป๋า");
      const amt = parseInputAmount("inStake", stcexDec);

      setStatus("⏳ กำลัง Stake...");
      const tx = await staking.stakeWithSTCEx(amt);
      await tx.wait();

      setStatus("✅ Stake สำเร็จ");
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.shortMessage || e?.message || e}`);
    }
  }

  async function withdrawPosition(posId) {
    try {
      if (!user) throw new Error("กรุณาเชื่อมต่อกระเป๋า");

      setStatus(`⏳ กำลัง Withdraw posId=${posId}...`);
      const tx = await staking.withdrawPosition(posId);
      await tx.wait();

      setStatus(`✅ Withdraw สำเร็จ (posId=${posId})`);
      await refreshAll();
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.shortMessage || e?.message || e}`);
    }
  }

  // ---------- Bind UI ----------
  function bind() {
    $("btnConnect").addEventListener("click", connect);
    $("btnRefresh").addEventListener("click", refreshAll);
    $("btnApprove").addEventListener("click", approveSTCEx);
    $("btnStake").addEventListener("click", stake);

    $("btnAddSTCEx").addEventListener("click", async () => {
      try {
        await addTokenToWallet(C.STCEX);
        setStatus("✅ เพิ่ม STCEx เข้า Wallet แล้ว");
      } catch (e) {
        console.error(e);
        setStatus(`❌ เพิ่ม STCEx ไม่สำเร็จ: ${e?.message || e}`);
      }
    });

    $("btnAddSTC").addEventListener("click", async () => {
      try {
        await addTokenToWallet(C.STC);
        setStatus("✅ เพิ่ม STC เข้า Wallet แล้ว");
      } catch (e) {
        console.error(e);
        setStatus(`❌ เพิ่ม STC ไม่สำเร็จ: ${e?.message || e}`);
      }
    });
  }

  bind();
})();
