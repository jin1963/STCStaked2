(() => {
  "use strict";

  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = String(t ?? "-"); };
  const setStatus = (t) => { const el = $("status"); if (el) el.textContent = t; };

  const ERC20_ABI = [
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
    "function decimals() view returns(uint8)",
    "function symbol() view returns(string)"
  ];

  const STAKING_ABI = [
    "function positionsCount(address) view returns(uint256)",
    "function getPosition(address,uint256) view returns(uint256,uint256,bool)",
    "function unlockAt(address,uint256) view returns(uint256)",
    "function timeUntilUnlock(address,uint256) view returns(uint256)",
    "function accruedRewardSTC(address,uint256) view returns(uint256,uint256)",
    "function matured(address,uint256) view returns(bool)",
    "function stakeWithSTCEx(uint256)",
    "function withdrawPosition(uint256)"
  ];

  let provider, signer, user;
  let staking, stcex, stc;
  let stcexDec = 18, stcDec = 18;

  async function ensureBSC() {
    const cur = await ethereum.request({ method: "eth_chainId" });
    if (cur === C.CHAIN_ID_HEX) return;

    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: C.CHAIN_ID_HEX }],
    });
  }

  async function connect() {
    try {
      await ensureBSC();

      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      user = await signer.getAddress();

      staking = new ethers.Contract(C.CONTRACT, STAKING_ABI, signer);
      stcex = new ethers.Contract(C.STCEX, ERC20_ABI, signer);
      stc = new ethers.Contract(C.STC, ERC20_ABI, signer);

      stcexDec = Number(await stcex.decimals());
      stcDec = Number(await stc.decimals());

      setText("wallet", user.slice(0,6)+"..."+user.slice(-4));
      setText("contract", C.CONTRACT);
      $("linkContract").href = C.EXPLORER + "/address/" + C.CONTRACT;
      $("linkWallet").href = C.EXPLORER + "/address/" + user;

      $("btnApprove").disabled = false;
      $("btnStake").disabled = false;
      $("btnRefresh").disabled = false;
      $("btnAddSTCEx").disabled = false;
      $("btnAddSTC").disabled = false;

      setStatus("✅ เชื่อมต่อสำเร็จ (BSC)");
      refreshAll();

    } catch (e) {
      setStatus("❌ " + e.message);
    }
  }

  async function refreshBalances() {
    const [b1,b2,alw] = await Promise.all([
      stcex.balanceOf(user),
      stc.balanceOf(user),
      stcex.allowance(user, C.CONTRACT)
    ]);
    setText("balSTCEx", ethers.formatUnits(b1, stcexDec));
    setText("balSTC", ethers.formatUnits(b2, stcDec));
    setText("allowSTCEx", ethers.formatUnits(alw, stcexDec));
  }

  async function refreshPositions() {
    const count = Number(await staking.positionsCount(user));
    const tbody = $("posTbody");
    tbody.innerHTML = "";

    for (let i=0;i<count;i++) {
      const pos = await staking.getPosition(user,i);
      const unlock = await staking.unlockAt(user,i);
      const reward = await staking.accruedRewardSTC(user,i);
      const matured = await staking.matured(user,i);

      tbody.innerHTML += `
        <tr>
          <td>${i}</td>
          <td>${ethers.formatUnits(pos[0], stcDec)}</td>
          <td>${new Date(Number(unlock)*1000).toLocaleDateString()}</td>
          <td>-</td>
          <td>${ethers.formatUnits(reward[0], stcDec)}</td>
          <td>${matured?"MATURED":"LOCKED"}</td>
          <td><button onclick="withdraw(${i})" ${!matured?"disabled":""}>Withdraw</button></td>
        </tr>
      `;
    }
  }

  async function refreshAll() {
    await refreshBalances();
    await refreshPositions();
  }

  async function approveSTCEx() {
    const amt = ethers.parseUnits($("inStake").value, stcexDec);
    const tx = await stcex.approve(C.CONTRACT, amt);
    await tx.wait();
    refreshBalances();
  }

  async function stake() {
    const amt = ethers.parseUnits($("inStake").value, stcexDec);
    const tx = await staking.stakeWithSTCEx(amt);
    await tx.wait();
    refreshAll();
  }

  async function withdraw(id) {
    const tx = await staking.withdrawPosition(id);
    await tx.wait();
    refreshAll();
  }

  async function addToken(addr) {
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const symbol = await token.symbol();
    const decimals = await token.decimals();

    await ethereum.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: { address: addr, symbol, decimals }
      }
    });
  }

  window.withdraw = withdraw;

  window.addEventListener("load",()=>{
    $("btnConnect").onclick = connect;
    $("btnRefresh").onclick = refreshAll;
    $("btnApprove").onclick = approveSTCEx;
    $("btnStake").onclick = stake;
    $("btnAddSTCEx").onclick = ()=>addToken(C.STCEX);
    $("btnAddSTC").onclick = ()=>addToken(C.STC);
  });

})();
