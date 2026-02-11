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

  // ---------- Add Token ----------
  async function addTokenToWallet(tokenAddress, tokenSymbol, tokenDecimals) {
    if (!window.ethereum) {
      setStatus("❌ ไม่พบกระเป๋า");
      return false;
    }
    try {
      const wasAdded = await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddress,
            symbol: tokenSymbol,
            decimals: tokenDecimals,
          },
        },
      });
      return wasAdded;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  // ---------- ABIs ----------
  const ERC20_ABI = [
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
    "function decimals() view returns(uint8)"
  ];

  const STAKING_ABI = [
    "function owner() view returns(address)",
    "function positionsCount(address) view returns(uint256)",
    "function getPosition(address,uint256) view returns(uint256,uint256,bool)",
    "function unlockAt(address,uint256) view returns(uint256)",
    "function timeUntilUnlock(address,uint256) view returns(uint256)",
    "function accruedRewardSTC(address,uint256) view returns(uint256,uint256)",
    "function matured(address,uint256) view returns(bool)",
    "function stakeWithSTCEx(uint256) external",
    "function withdrawPosition(uint256) external",
    "function minStakeSTCEx() view returns(uint256)"
  ];

  // ---------- State ----------
  let provider, signer, user;
  let staking, stcex, stc;
  let stcexDec = 18, stcDec = 18;
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
      if (!window.ethereum) throw new Error("ไม่พบกระเป๋า");

      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      user = await signer.getAddress();

      setText("wallet", shortAddr(user));
      setText("contract", C.CONTRACT);

      $("linkContract").href = `${C.BLOCK_EXPLORER}/address/${C.CONTRACT}`;
      $("linkWallet").href = `${C.BLOCK_EXPLORER}/address/${user}`;

      staking = new ethers.Contract(C.CONTRACT, STAKING_ABI, signer);
      stcex = new ethers.Contract(C.STCEX, ERC20_ABI, signer);
      stc = new ethers.Contract(C.STC, ERC20_ABI, signer);

      try { stcexDec = Number(await stcex.decimals()); } catch {}
      try { stcDec = Number(await stc.decimals()); } catch {}

      const ownerAddr = await staking.owner();
      const isOwner = ownerAddr.toLowerCase() === user.toLowerCase();
      setText("owner", shortAddr(ownerAddr));
      setText("isOwner", isOwner ? "YES" : "NO");

      applyOwnerVisibility(isOwner);

      // Enable buttons
      $("btnRefresh").disabled = false;
      $("btnApprove").disabled = false;
      $("btnStake").disabled = false;

      // Enable add token buttons
      if ($("btnAddSTCEx")) {
        $("btnAddSTCEx").disabled = false;
        $("btnAddSTCEx").onclick = async () => {
          const ok = await addTokenToWallet(C.STCEX, "STCEx", stcexDec);
          setStatus(ok ? "✅ เพิ่ม STCEx แล้ว" : "ℹ️ ยกเลิกหรือไม่รองรับ");
        };
      }

      if ($("btnAddSTC")) {
        $("btnAddSTC").disabled = false;
        $("btnAddSTC").onclick = async () => {
          const ok = await addTokenToWallet(C.STC, "STC", stcDec);
          setStatus(ok ? "✅ เพิ่ม STC แล้ว" : "ℹ️ ยกเลิกหรือไม่รองรับ");
        };
      }

      setStatus("✅ เชื่อมต่อสำเร็จ");
      await refreshPositions();

      if (timer) clearInterval(timer);
      timer = setInterval(updateCountdownCells, 1000);

    } catch (e) {
      console.error(e);
      setStatus("❌ " + (e?.message || e));
    }
  }

  // ---------- Stake ----------
  function parseInputAmount(id, dec) {
    const v = ($(id).value || "").trim();
    return ethers.parseUnits(v, dec);
  }

  async function stake() {
    try {
      const amt = parseInputAmount("inStake", stcexDec);
      const minStake = await staking.minStakeSTCEx();
      if (amt < minStake) throw new Error("ต่ำกว่าขั้นต่ำ");

      const tx = await staking.stakeWithSTCEx(amt);
      await tx.wait();
      setStatus("✅ Stake สำเร็จ");
      await refreshPositions();
    } catch (e) {
      setStatus("❌ Stake ไม่สำเร็จ");
    }
  }

  async function withdrawPosition(posId) {
    try {
      const tx = await staking.withdrawPosition(posId);
      await tx.wait();
      setStatus("✅ ถอนสำเร็จ");
      await refreshPositions();
    } catch {
      setStatus("❌ ถอนล้มเหลว");
    }
  }

  // ---------- Positions ----------
  async function refreshPositions() {
    if (!user) return;

    const count = Number(await staking.positionsCount(user));
    setText("posCount", count);

    const tbody = $("posTbody");
    tbody.innerHTML = "";

    for (let i = 0; i < count; i++) {
      const pos = await staking.getPosition(user, i);
      const unlockAt = await staking.unlockAt(user, i);
      const matured = await staking.matured(user, i);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i}</td>
        <td>${ethers.formatUnits(pos[0], stcDec)}</td>
        <td>${fmtDate(pos[1])}</td>
        <td>${fmtDate(unlockAt)}</td>
        <td data-posid="${i}" data-col="countdown">-</td>
        <td>-</td>
        <td>-</td>
        <td>${matured ? "MATURED" : "LOCKED"}</td>
        <td>
          <button ${!matured ? "disabled" : ""} onclick="withdrawPosition(${i})">
            Withdraw
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  function updateCountdownCells() {
    const cells = document.querySelectorAll('[data-col="countdown"]');
    cells.forEach(el => {
      const posId = el.dataset.posid;
      // แสดง placeholder หรือจะคำนวณจริงเพิ่มได้
      el.textContent = "...";
    });
  }

  // ---------- Bind ----------
  function bindUI() {
    $("btnConnect").addEventListener("click", connect);
    $("btnStake").addEventListener("click", stake);
  }

  bindUI();
})();
