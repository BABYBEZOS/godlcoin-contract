const { ethers } = require("hardhat");
const { describe } = require("mocha");
let chai = require("chai");
chai.use(require("chai-as-promised"));
const { assert, expect } = chai;
const { BigNumber } = ethers;
const { MaxUint256 } = ethers.constants;
const { parseEther } = ethers.utils;

const ETH_BALANCE_THRESHOLD = parseEther("0.001");
const INITIAL_GODL_RESERVES = parseEther("500000000");
const INITIAL_ETH_RESERVES = parseEther("100");

let godl;
let owner;
let rewardAcct1;
let rewardAcct2;
let liqAcct;
let noFeesAcct;

async function setUp() {
  const IterableMapping = await ethers.getContractFactory("IterableMapping");
  const iterableMapping = await IterableMapping.deploy();
  await iterableMapping.deployed();

  const GODL = await ethers.getContractFactory("GODL", {
    libraries: {
      IterableMapping: iterableMapping.address,
    },
  });
  godl = await GODL.deploy();
  await godl.deployed();

  [owner, rewardAcct1, rewardAcct2, liqAcct, noFeesAcct] =
    await ethers.getSigners();

  // Add initial liquidity.
  const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  let router = await ethers.getContractAt("IUniswapV2Router02", routerAddress);

  await expect(godl.approve(routerAddress, MaxUint256)).to.eventually.be
    .fulfilled;
  await expect(
    router.addLiquidityETH(
      godl.address,
      INITIAL_GODL_RESERVES,
      parseEther("0"), // slippage is unavoidable
      parseEther("0"), // slippage is unavoidable
      liqAcct.address,
      MaxUint256,
      { value: INITIAL_ETH_RESERVES }
    )
  ).to.eventually.be.fulfilled;
}

describe("GODL", function () {
  before(setUp);

  it("should return correct name", async function () {
    await expect(godl.name()).to.eventually.equal("GODL");
  });

  it("should return correct symbol", async function () {
    await expect(godl.symbol()).to.eventually.equal("GODL");
  });

  it("should use anti bot by default", async function () {
    await expect(godl.useAntiBot()).to.eventually.be.true;
  });

  it("should allow accounts to transfer before go-live", async function () {
    await expect(godl.canTransferBeforeTradingIsEnabled(noFeesAcct.address)).to
      .eventually.be.false;
    await expect(godl.allowTransferBeforeTradingIsEnabled(noFeesAcct.address))
      .to.be.fulfilled;
    await expect(godl.canTransferBeforeTradingIsEnabled(noFeesAcct.address)).to
      .eventually.be.true;
  });

  it("should exclude account from fees", async function () {
    await expect(godl.isExcludedFromFees(noFeesAcct.address)).to.eventually.be
      .false;
    await expect(godl.excludeFromFees(noFeesAcct.address)).to.eventually.be
      .fulfilled;
    await expect(godl.isExcludedFromFees(noFeesAcct.address)).to.eventually.be
      .true;
  });

  it("should allow assigning anti bot address", async function () {
    const tx = expect(
      godl.updateAntiBot("0xCD5312d086f078D1554e8813C27Cf6C9D1C3D9b3")
    );
    await tx.to.emit(godl, "UpdatedAntiBot");
    await tx.to.eventually.be.fulfilled;
  });

  it("should use 18 decimals", async function () {
    await expect(godl.decimals()).to.eventually.equal(BigNumber.from(18));
  });

  it("should have the 1B supply", async function () {
    await expect(godl.totalSupply()).to.eventually.equal(
      parseEther("1000000000")
    );
  });

  it("should return the max sell token amount", async function () {
    await expect(godl.MAX_SELL_TRANSACTION_AMOUNT()).to.eventually.equal(
      parseEther("1000000")
    );
  });

  it("should return the liquidation amount threshold", async function () {
    await expect(godl.liquidateTokensAtAmount()).to.eventually.equal(
      parseEther("100000")
    );
  });

  it("should update the liquidation amount threshold", async function () {
    await expect(godl.updateLiquidationThreshold(parseEther("200001"))).to
      .eventually.be.rejected;

    const tx = expect(godl.updateLiquidationThreshold(parseEther("80000")));
    await tx.to
      .emit(godl, "LiquidationThresholdUpdated")
      .withArgs(parseEther("80000"), parseEther("100000"));
    await tx.to.eventually.be.fulfilled;
  });

  it("should have the correct owner", async function () {
    await expect(godl.owner()).to.eventually.equal(owner.address);
  });

  it("should enforce the onlyOwner modifier", async function () {
    await expect(
      godl.connect(noFeesAcct).excludeFromFees(noFeesAcct.address, true)
    ).to.eventually.be.rejected;
  });

  it("should have the correct liquidityWallet", async function () {
    await expect(godl.liquidityWallet()).to.eventually.equal(owner.address);
  });

  it("should allow owner to update the liquidityWallet", async function () {
    await expect(godl.updateLiquidityWallet(liqAcct.address)).to.eventually.be
      .fulfilled;
    await expect(godl.liquidityWallet()).to.eventually.equal(liqAcct.address);
  });

  it("should update the gas for processing dividends", async function () {
    await expect(godl.updateGasForProcessing(400000)).to.eventually.be
      .fulfilled;
  });

  it("should have the correct ETH rewards fee", async function () {
    await expect(godl.ETH_REWARDS_FEE()).to.eventually.equal(BigNumber.from(5));
  });

  it("should have the correct liquidity fee", async function () {
    await expect(godl.LIQUIDITY_FEE()).to.eventually.equal(BigNumber.from(3));
  });

  it("should have the correct total fee", async function () {
    await expect(godl.TOTAL_FEES()).to.eventually.equal(BigNumber.from(8));
  });

  it("should have claim wait set to 1 hour by default", async function () {
    await expect(godl.getClaimWait()).to.eventually.equal(BigNumber.from(3600));
  });

  it("should return whether account is excluded from fees", async function () {
    await expect(godl.isExcludedFromFees(owner.address)).to.eventually.be.true;
    await expect(godl.isExcludedFromFees(liqAcct.address)).to.eventually.be
      .true;
    await expect(godl.isExcludedFromFees(noFeesAcct.address)).to.eventually.be
      .true;
    await expect(godl.isExcludedFromFees(rewardAcct1.address)).to.eventually.be
      .false;
  });

  it("should always have the uniswap pair in the AMM pairs", async function () {
    const uniPairAddress = await godl.uniswapV2Pair();
    await expect(godl.automatedMarketMakerPairs(uniPairAddress)).to.eventually
      .be.true;
  });

  it("should only allow owner to transfer prior to go-live", async function () {
    await expect(godl.tradingEnabled()).to.eventually.be.false;

    await expect(godl.approve(owner.address, parseEther("10000"))).to.eventually
      .be.fulfilled;
    await expect(
      godl.transferFrom(owner.address, rewardAcct1.address, parseEther("10000"))
    ).to.eventually.be.fulfilled;

    await expect(
      godl.connect(rewardAcct1).approve(owner.address, parseEther("1"))
    ).to.eventually.be.fulfilled;
    await expect(
      godl.transferFrom(
        rewardAcct1.address,
        noFeesAcct.address,
        parseEther("1")
      )
    ).to.eventually.be.rejected;
  });

  it("should allow all accounts to transfer after go-live", async function () {
    await expect(godl.activate()).to.eventually.be.fulfilled;
    await expect(godl.tradingEnabled()).to.eventually.be.true;

    await expect(
      godl.connect(rewardAcct1).approve(owner.address, parseEther("10000"))
    ).to.eventually.be.fulfilled;
    await expect(
      godl.transferFrom(
        rewardAcct1.address,
        noFeesAcct.address,
        parseEther("10000")
      )
    ).to.eventually.be.fulfilled;

    await expect(godl.approve(owner.address, parseEther("1000001"))).to
      .eventually.be.fulfilled;
    await expect(
      godl.transferFrom(
        owner.address,
        rewardAcct1.address,
        parseEther("1000001")
      )
    ).to.eventually.be.fulfilled;
  });

  it("should return the correct balance", async function () {
    await expect(godl.balanceOf(owner.address)).to.eventually.equal(
      parseEther("498989999")
    );
    await expect(godl.balanceOf(rewardAcct1.address)).to.eventually.equal(
      parseEther("1000001")
    );
    await expect(godl.balanceOf(noFeesAcct.address)).to.eventually.equal(
      parseEther("10000")
    );
  });

  it("should enforce the max sell amount", async function () {
    const uniPairAddress = await godl.uniswapV2Pair();
    await expect(
      godl.connect(rewardAcct1).approve(owner.address, parseEther("1000001"))
    ).to.eventually.be.fulfilled;
    await expect(
      godl.transferFrom(
        rewardAcct1.address,
        uniPairAddress,
        parseEther("1000001")
      )
    ).to.eventually.be.rejected;
  });

  it("should apply transfer fee", async function () {
    await expect(
      godl.connect(rewardAcct1).approve(owner.address, parseEther("1000000"))
    ).to.eventually.be.fulfilled;
    await expect(
      godl.transferFrom(
        rewardAcct1.address,
        rewardAcct2.address,
        parseEther("1000000")
      )
    ).to.eventually.be.fulfilled;

    await expect(godl.balanceOf(godl.address)).to.eventually.equal(
      parseEther("80000")
    );
    await expect(godl.balanceOf(rewardAcct1.address)).to.eventually.equal(
      parseEther("1")
    );
    await expect(godl.balanceOf(rewardAcct2.address)).to.eventually.equal(
      parseEther("920000")
    );
  });

  it("should liquidate when balance threshold is reached", async function () {
    const divTrackerAddress = await godl.dividendTracker();
    await expect(ethers.provider.getBalance(godl.address)).to.eventually.equal(
      BigNumber.from(0)
    );
    await expect(
      ethers.provider.getBalance(divTrackerAddress)
    ).to.eventually.equal(BigNumber.from(0));

    await expect(godl.balanceOf(rewardAcct1.address)).to.eventually.equal(
      parseEther("1")
    );
    const initEthRewardAcct1 = await ethers.provider.getBalance(
      rewardAcct1.address
    );
    const initEthRewardAcct2 = await ethers.provider.getBalance(
      rewardAcct2.address
    );
    const initEthNoFeesAcct = await ethers.provider.getBalance(
      noFeesAcct.address
    );

    await expect(godl.balanceOf(godl.address)).to.eventually.equal(
      parseEther("80000")
    );

    await expect(
      godl.connect(rewardAcct2).approve(owner.address, parseEther("50000"))
    ).to.eventually.be.fulfilled;
    const tx = expect(
      godl.transferFrom(
        rewardAcct2.address,
        rewardAcct1.address,
        parseEther("50000")
      )
    );
    await tx.to.emit(godl, "Liquified");
    await tx.to.emit(godl, "SentDividends");
    await tx.to.eventually.be.fulfilled;

    await expect(godl.balanceOf(godl.address)).to.eventually.equal(
      parseEther("4000")
    );
    await expect(godl.balanceOf(rewardAcct1.address)).to.eventually.equal(
      parseEther("46001")
    );

    const finalEthRewardAcct1 = await ethers.provider.getBalance(
      rewardAcct1.address
    );
    const finalEthRewardAcct2 = await ethers.provider.getBalance(
      rewardAcct2.address
    );
    const finalEthNoFeesAcct = await ethers.provider.getBalance(
      noFeesAcct.address
    );

    assert.isTrue(initEthRewardAcct1.eq(finalEthRewardAcct1));
    assert.isTrue(finalEthRewardAcct2.gt(initEthRewardAcct2));
    assert.isTrue(finalEthNoFeesAcct.gt(initEthNoFeesAcct));
  });

  it("should add to liquidity", async function () {
    const lpAddress = await godl.uniswapV2Pair();
    const lp = await ethers.getContractAt("IUniswapV2Pair", lpAddress);
    const [godlReserves, ethReserves] = await lp.getReserves();
    const oldConstantProduct = INITIAL_ETH_RESERVES.mul(INITIAL_GODL_RESERVES);
    const newConstantProduct = godlReserves.mul(ethReserves);
    assert.isTrue(newConstantProduct.gt(oldConstantProduct));
  });

  it("should return the dividend balance of an account", async function () {
    await expect(
      godl.dividendTokenBalanceOf(rewardAcct1.address)
    ).to.eventually.equal(parseEther("46001"));
    await expect(
      godl.dividendTokenBalanceOf(rewardAcct2.address)
    ).to.eventually.equal(parseEther("870000"));
    await expect(
      godl.dividendTokenBalanceOf(noFeesAcct.address)
    ).to.eventually.equal(parseEther("10000"));
  });

  it("should return the last processed index", async function () {
    await expect(godl.getLastProcessedIndex()).to.eventually.equal(
      BigNumber.from(0)
    );
  });

  it("should return the total dividends distributed", async function () {
    await expect(godl.getTotalDividendsDistributed()).to.eventually.equal(
      parseEther("0.009977290168617083")
    );
  });

  it("should return the number of eligible reward holders", async function () {
    await expect(godl.getNumberOfDividendTokenHolders()).to.eventually.equal(
      BigNumber.from(3)
    );
  });

  it("should return the account dividend info by index", async function () {
    const [
      acct,
      index,
      iterationsUntilProcessed,
      withdrawableDividends,
      totalDividends,
      lastClaimTime,
      nextClaimTime,
      secondsUntilAutoClaimAvailable,
    ] = await godl.getAccountDividendsInfoAtIndex(0);

    assert.equal(acct, noFeesAcct.address);
    assert.equal(index.toNumber(), 0);
    assert.equal(iterationsUntilProcessed.toNumber(), 3);
    assert.equal(withdrawableDividends.toNumber(), 0);
    assert.isTrue(totalDividends.eq(parseEther("0.000107282689985129")));
    assert.isTrue(lastClaimTime.toNumber() > 0);
    assert.isTrue(nextClaimTime > lastClaimTime);
    assert.equal(nextClaimTime - lastClaimTime, 3600);
    assert.equal(secondsUntilAutoClaimAvailable, 3600);
  });

  it("should return the account dividend info by address", async function () {
    const [
      acct,
      index,
      iterationsUntilProcessed,
      withdrawableDividends,
      totalDividends,
      lastClaimTime,
      nextClaimTime,
      secondsUntilAutoClaimAvailable,
    ] = await godl.getAccountDividendsInfo(rewardAcct2.address);

    assert.equal(rewardAcct2.address, acct);
    assert.equal(index.toNumber(), 1);
    assert.equal(iterationsUntilProcessed.toNumber(), 1);
    assert.equal(withdrawableDividends.toNumber(), 0);
    assert.isTrue(totalDividends.eq(parseEther("0.009870007478631953")));
    assert.isTrue(lastClaimTime.toNumber() > 0);
    assert.isTrue(nextClaimTime > lastClaimTime);
    assert.equal(nextClaimTime - lastClaimTime, 3600);
    assert.equal(secondsUntilAutoClaimAvailable, 3600);
  });

  it("should allow users to claim their dividends", async function () {
    await expect(
      owner.sendTransaction({
        to: await godl.dividendTracker(),
        value: parseEther("10"),
      })
    ).to.eventually.be.fulfilled;

    const initEthRewardAcct = await ethers.provider.getBalance(
      rewardAcct2.address
    );
    const initDividendRewardAcct2 = await godl.withdrawableDividendOf(
      rewardAcct2.address
    );
    assert.isTrue(
      initDividendRewardAcct2.eq(parseEther("9.39523823408398047"))
    );

    await expect(godl.connect(rewardAcct2).claim()).to.eventually.be.fulfilled;

    const finalEthRewardAcct = await ethers.provider.getBalance(
      rewardAcct2.address
    );
    assert.isTrue(
      parseEther("9.39523823408398047")
        .sub(finalEthRewardAcct.sub(initEthRewardAcct))
        .lt(ETH_BALANCE_THRESHOLD)
    );

    const finalDividendRewardAcct2 = await godl.withdrawableDividendOf(
      rewardAcct2.address
    );
    assert.isTrue(finalDividendRewardAcct2.eq(BigNumber.from(0)));
  });

  it("should allow updating gas fee for ETH transfers", async function () {
    await expect(godl.getGasForTransfer()).to.eventually.equal(
      BigNumber.from(3000)
    );

    await expect(godl.updateGasForTransfer(3001)).to.eventually.be.fulfilled;

    await expect(godl.getGasForTransfer()).to.eventually.equal(
      BigNumber.from(3001)
    );
  });

  it("should neither mint nor burn tokens", async function () {
    await expect(godl.totalSupply()).to.eventually.equal(
      parseEther("1000000000")
    );
  });

  it("should accumulate rewards even if not claimed", async function () {
    await expect(
      godl.withdrawableDividendOf(rewardAcct1.address)
    ).to.eventually.equal(parseEther("0.496770521846088719"));
    await expect(
      godl.withdrawableDividendOf(rewardAcct2.address)
    ).to.eventually.equal(BigNumber.from(0));
    await expect(
      godl.withdrawableDividendOf(noFeesAcct.address)
    ).to.eventually.equal(parseEther("0.10799124406993081"));

    await expect(godl.connect(rewardAcct1).claim()).to.eventually.be.fulfilled;

    await expect(
      godl.withdrawableDividendOf(rewardAcct1.address)
    ).to.eventually.equal(BigNumber.from(0));
    await expect(
      godl.withdrawableDividendOf(rewardAcct2.address)
    ).to.eventually.equal(BigNumber.from(0));
    await expect(
      godl.withdrawableDividendOf(noFeesAcct.address)
    ).to.eventually.equal(parseEther("0.10799124406993081"));

    await expect(
      owner.sendTransaction({
        to: await godl.dividendTracker(),
        value: parseEther("10"),
      })
    ).to.eventually.be.fulfilled;

    await expect(
      godl.withdrawableDividendOf(rewardAcct1.address)
    ).to.eventually.equal(parseEther("0.496770521846088719"));
    await expect(
      godl.withdrawableDividendOf(rewardAcct2.address)
    ).to.eventually.equal(parseEther("9.395238234083980471"));
    await expect(
      godl.withdrawableDividendOf(noFeesAcct.address)
    ).to.eventually.equal(parseEther("0.21598248813986162"));
  });

  it("should allow anyone to process the dividend tracker", async function () {
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);

    const tx = expect(
      godl.connect(rewardAcct1).processDividendTracker(BigNumber.from(500000))
    );
    await tx.to
      .emit(godl, "ProcessedDividendTracker")
      .withArgs(
        BigNumber.from(3),
        BigNumber.from(3),
        BigNumber.from(0),
        false,
        BigNumber.from(500000),
        rewardAcct1.address
      );
    await tx.to.eventually.be.fulfilled;
  });

  it("should allow owner to update claim wait time", async function () {
    await expect(godl.updateClaimWait(7200)).to.eventually.be.fulfilled;
    await expect(godl.getClaimWait()).to.eventually.equal(BigNumber.from(7200));
  });

  it("should allow toggling anti bot feature", async function () {
    const tx = expect(godl.toggleAntiBot());
    await tx.to.emit(godl, "ToggledAntiBot").withArgs(false, true);
    await tx.to.eventually.be.fulfilled;

    await expect(godl.useAntiBot()).to.eventually.be.false;
  });
});
