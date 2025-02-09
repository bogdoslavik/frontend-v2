import { SubgraphPoolBase, SwapType, SwapTypes } from '@balancer-labs/sdk';
import { BigNumber, formatFixed, parseFixed } from '@ethersproject/bignumber';
import {
  AddressZero,
  WeiPerEther as ONE,
  Zero,
} from '@ethersproject/constants';
import { TransactionResponse } from '@ethersproject/providers';
import { formatUnits, parseUnits } from '@ethersproject/units';
import {
  computed,
  ComputedRef,
  onMounted,
  reactive,
  Ref,
  ref,
  toRefs,
} from 'vue';
import { useI18n } from 'vue-i18n';

import { NATIVE_ASSET_ADDRESS } from '@/constants/tokens';
import { balancer } from '@/lib/balancer.sdk';
import { bnum, isSameAddress } from '@/lib/utils';
import {
  SorManager,
  SorReturn,
} from '@/lib/utils/balancer/helpers/sor/sorManager';
import { convertStEthWrap, isStEthAddress } from '@/lib/utils/balancer/lido';
import { swapIn, swapOut } from '@/lib/utils/balancer/swapper';
import {
  getWrapOutput,
  unwrap,
  wrap,
  WrapType,
} from '@/lib/utils/balancer/wrapper';
import { configService } from '@/services/config/config.service';
import { rpcProviderService } from '@/services/rpc-provider/rpc-provider.service';
import useWeb3 from '@/services/web3/useWeb3';
import { TokenInfo } from '@/types/TokenList';

import useEthers from '../useEthers';
import useFathom from '../useFathom';
import useNumbers, { FNumFormats } from '../useNumbers';
import { isMainnet } from '../useNetwork';
import { useTokens } from '@/providers/tokens.provider';
import useTransactions, { TransactionAction } from '../useTransactions';
import { TradeQuote } from './types';
import { captureException } from '@sentry/browser';

type SorState = {
  validationErrors: {
    highPriceImpact: boolean;
  };
  submissionError: string | null;
};

const GAS_PRICE = process.env.VUE_APP_GAS_PRICE || '100000000000';
const MAX_POOLS = process.env.VUE_APP_MAX_POOLS || '4';
const MIN_PRICE_IMPACT = 0.0001;
const HIGH_PRICE_IMPACT_THRESHOLD = 0.05;
const state = reactive<SorState>({
  validationErrors: {
    highPriceImpact: false,
  },
  submissionError: null,
});

type Props = {
  exactIn: Ref<boolean>;
  tokenInAddressInput: Ref<string>;
  tokenInAmountInput: Ref<string>;
  tokenOutAddressInput: Ref<string>;
  tokenOutAmountInput: Ref<string>;
  wrapType: Ref<WrapType>;
  tokenInAmountScaled?: ComputedRef<BigNumber>;
  tokenOutAmountScaled?: ComputedRef<BigNumber>;
  sorConfig?: {
    handleAmountsOnFetchPools: boolean;
  };
  tokenIn: ComputedRef<TokenInfo>;
  tokenOut: ComputedRef<TokenInfo>;
  slippageBufferRate: ComputedRef<number>;
};

export type UseSor = ReturnType<typeof useSor>;

export default function useSor({
  exactIn,
  tokenInAddressInput,
  tokenInAmountInput,
  tokenOutAddressInput,
  tokenOutAmountInput,
  wrapType,
  tokenInAmountScaled,
  tokenOutAmountScaled,
  sorConfig = {
    handleAmountsOnFetchPools: true,
  },
  tokenIn,
  tokenOut,
  slippageBufferRate,
}: Props) {
  let sorManager: SorManager | undefined = undefined;
  const pools = ref<SubgraphPoolBase[]>([]);
  const sorReturn = ref<SorReturn>({
    hasSwaps: false,
    tokenIn: '',
    tokenOut: '',
    returnDecimals: 18,
    returnAmount: Zero,
    marketSpNormalised: '0',
    result: {
      tokenAddresses: [],
      swaps: [],
      swapAmount: Zero,
      returnAmount: Zero,
      returnAmountConsideringFees: Zero,
      tokenIn: '',
      tokenOut: '',
      marketSp: '0',
      swapAmountForSwaps: Zero,
      returnAmountFromSwaps: Zero,
    },
  });
  const trading = ref(false);
  const confirming = ref(false);
  const priceImpact = ref(0);
  const latestTxHash = ref('');
  const poolsLoading = ref(true);

  // COMPOSABLES
  const { getProvider: getWeb3Provider, appNetworkConfig } = useWeb3();
  const provider = computed(() => getWeb3Provider());
  const { trackGoal, Goals } = useFathom();
  const { txListener } = useEthers();
  const { addTransaction } = useTransactions();
  const { fNum2, toFiat } = useNumbers();
  const { t } = useI18n();
  const { injectTokens, priceFor, getToken } = useTokens();

  onMounted(async () => {
    const unknownAssets: string[] = [];
    if (tokenInAddressInput.value && !getToken(tokenInAddressInput.value)) {
      unknownAssets.push(tokenInAddressInput.value);
    }
    if (tokenOutAddressInput.value && !getToken(tokenOutAddressInput.value)) {
      unknownAssets.push(tokenOutAddressInput.value);
    }
    await injectTokens(unknownAssets);
    await initSor();
    await handleAmountChange();
  });

  function resetState() {
    state.validationErrors.highPriceImpact = false;

    state.submissionError = null;
  }

  async function initSor(): Promise<void> {
    sorManager = new SorManager(
      rpcProviderService.jsonProvider,
      BigNumber.from(GAS_PRICE),
      Number(MAX_POOLS),
      configService.network.chainId,
      configService.network.addresses.weth
    );

    fetchPools();
  }

  async function fetchPools(): Promise<void> {
    if (!sorManager) {
      return;
    }

    console.time('[SOR] fetchPools');
    await sorManager.fetchPools();
    console.timeEnd('[SOR] fetchPools');
    poolsLoading.value = false;
    // Updates any swaps with up to date pools/balances
    if (sorConfig.handleAmountsOnFetchPools) {
      handleAmountChange();
    }
  }

  function trackSwapEvent() {
    trackGoal(Goals.BalancerSwap);
    if (isMainnet.value) trackGoal(Goals.BalancerSwapMainnet);
  }

  async function updateTradeAmounts(): Promise<void> {
    if (!sorManager) {
      return;
    }
    if (sorReturn.value.hasSwaps && !confirming.value) {
      const { result } = sorReturn.value;

      const swapType: SwapType = exactIn.value
        ? SwapType.SwapExactIn
        : SwapType.SwapExactOut;

      const deltas = await balancer.swaps.queryBatchSwap({
        kind: swapType,
        swaps: result.swaps,
        assets: result.tokenAddresses,
      });

      if (result !== sorReturn.value.result) {
        // sorReturn was updated while we were querying, abort to not show stale data.
        return;
      }

      if (deltas.length >= 2) {
        const tokenInDecimals = getTokenDecimals(tokenInAddressInput.value);
        const tokenOutDecimals = getTokenDecimals(tokenOutAddressInput.value);

        let tokenInAddress =
          tokenInAddressInput.value === NATIVE_ASSET_ADDRESS
            ? AddressZero
            : tokenInAddressInput.value;
        let tokenOutAddress =
          tokenOutAddressInput.value === NATIVE_ASSET_ADDRESS
            ? AddressZero
            : tokenOutAddressInput.value;

        // If the token in/out is stETH then finding the token position
        // below doesn't work because result.tokenAddresses only includes
        // wstETH. This is a crude hack to replace token in/out address
        // with wstETH so the index mapping works.
        if (isStEthAddress(tokenInAddressInput.value))
          tokenInAddress = configService.network.addresses.wstETH;
        if (isStEthAddress(tokenOutAddressInput.value))
          tokenOutAddress = configService.network.addresses.wstETH;

        const tokenInPosition = result.tokenAddresses.indexOf(
          tokenInAddress.toLowerCase()
        );
        const tokenOutPosition = result.tokenAddresses.indexOf(
          tokenOutAddress.toLowerCase()
        );

        const tokenInAmount = BigNumber.from(deltas[tokenInPosition]).abs();

        const tokenOutAmount = BigNumber.from(deltas[tokenOutPosition]).abs();

        if (swapType === SwapType.SwapExactOut) {
          tokenInAmountInput.value = tokenInAmount.gt(0)
            ? formatAmount(formatUnits(tokenInAmount, tokenInDecimals))
            : '';
        }

        if (swapType === SwapType.SwapExactIn) {
          tokenOutAmountInput.value = tokenOutAmount.gt(0)
            ? formatAmount(formatUnits(tokenOutAmount, tokenOutDecimals))
            : '';
        }
      }
    }
  }

  function resetInputAmounts(amount: string): void {
    tokenInAmountInput.value = amount;
    tokenOutAmountInput.value = amount;
    priceImpact.value = 0;
    sorReturn.value.hasSwaps = false;
    sorReturn.value.returnAmount = Zero;
  }

  async function handleAmountChange(): Promise<void> {
    const amount = exactIn.value
      ? tokenInAmountInput.value
      : tokenOutAmountInput.value;
    // Avoid using SOR if querying a zero value or (un)wrapping trade
    const zeroValueTrade = amount === '' || amount === '0';
    if (zeroValueTrade) {
      resetInputAmounts(amount);
      return;
    }

    const tokenInAddress = tokenInAddressInput.value;
    const tokenOutAddress = tokenOutAddressInput.value;

    if (!tokenInAddress || !tokenOutAddress) {
      if (exactIn.value) tokenOutAmountInput.value = '';
      else tokenInAmountInput.value = '';
      return;
    }

    const tokenInDecimals = getTokenDecimals(tokenInAddressInput.value);
    const tokenOutDecimals = getTokenDecimals(tokenOutAddressInput.value);

    if (wrapType.value !== WrapType.NonWrap) {
      const wrapper =
        wrapType.value === WrapType.Wrap ? tokenOutAddress : tokenInAddress;

      if (exactIn.value) {
        tokenInAmountInput.value = amount;

        const outputAmount = await getWrapOutput(
          wrapper,
          wrapType.value,
          parseFixed(amount, tokenInDecimals)
        );
        tokenOutAmountInput.value = formatFixed(outputAmount, tokenInDecimals);
      } else {
        tokenOutAmountInput.value = amount;

        const inputAmount = await getWrapOutput(
          wrapper,
          wrapType.value === WrapType.Wrap ? WrapType.Unwrap : WrapType.Wrap,
          parseFixed(amount, tokenOutDecimals)
        );
        tokenInAmountInput.value = formatFixed(inputAmount, tokenOutDecimals);
      }

      sorReturn.value.hasSwaps = false;
      priceImpact.value = 0;
      return;
    }

    if (!sorManager || !sorManager.hasPoolData()) {
      if (exactIn.value) tokenOutAmountInput.value = '';
      else tokenInAmountInput.value = '';
      return;
    }

    if (exactIn.value) {
      await setSwapCost(
        tokenOutAddressInput.value,
        tokenOutDecimals,
        sorManager
      );

      const tokenInAmountScaled = parseUnits(amount, tokenInDecimals);

      console.log('[SOR Manager] swapExactIn');

      const swapReturn: SorReturn = await sorManager.getBestSwap(
        tokenInAddress,
        tokenOutAddress,
        tokenInDecimals,
        tokenOutDecimals,
        SwapTypes.SwapExactIn,
        tokenInAmountScaled
      );

      sorReturn.value = swapReturn; // TO DO - is it needed?
      let tokenOutAmount = swapReturn.returnAmount;

      tokenOutAmountInput.value = tokenOutAmount.gt(0)
        ? formatAmount(formatUnits(tokenOutAmount, tokenOutDecimals))
        : '';

      if (!sorReturn.value.hasSwaps) {
        priceImpact.value = 0;
      } else {
        tokenOutAmount = await adjustedPiAmount(
          tokenOutAmount,
          tokenOutAddress
        );

        const priceImpactCalc = calcPriceImpact(
          tokenOutDecimals,
          tokenOutAmount,
          tokenInAmountScaled,
          swapReturn
        );

        priceImpact.value = Math.max(
          Number(formatUnits(priceImpactCalc)),
          MIN_PRICE_IMPACT
        );
      }
    } else {
      // Notice that outputToken is tokenOut if swapType == 'swapExactIn' and tokenIn if swapType == 'swapExactOut'
      await setSwapCost(tokenInAddressInput.value, tokenInDecimals, sorManager);

      const tokenOutAmountScaled = parseUnits(amount, tokenOutDecimals);

      console.log('[SOR Manager] swapExactOut');

      const swapReturn: SorReturn = await sorManager.getBestSwap(
        tokenInAddress,
        tokenOutAddress,
        tokenInDecimals,
        tokenOutDecimals,
        SwapTypes.SwapExactOut,
        tokenOutAmountScaled
      );

      sorReturn.value = swapReturn; // TO DO - is it needed?

      let tokenInAmount = swapReturn.returnAmount;
      tokenInAmountInput.value = tokenInAmount.gt(0)
        ? formatAmount(formatUnits(tokenInAmount, tokenInDecimals))
        : '';

      if (!sorReturn.value.hasSwaps) {
        priceImpact.value = 0;
      } else {
        tokenInAmount = await adjustedPiAmount(tokenInAmount, tokenOutAddress);

        const priceImpactCalc = calcPriceImpact(
          tokenInDecimals,
          tokenInAmount,
          tokenOutAmountScaled,
          swapReturn
        );

        priceImpact.value = Math.max(
          Number(formatUnits(priceImpactCalc)),
          MIN_PRICE_IMPACT
        );
      }
    }

    pools.value = sorManager.selectedPools;

    state.validationErrors.highPriceImpact =
      priceImpact.value >= HIGH_PRICE_IMPACT_THRESHOLD;
  }

  function calcPriceImpact(
    tokenDecimals: number,
    tokenAmount: BigNumber,
    tokenAmountScaled: BigNumber,
    swapReturn: SorReturn
  ): BigNumber {
    const divScale = BigNumber.from(10).pow(tokenDecimals);
    const wadScale = BigNumber.from(10).pow(18);
    const effectivePrice = tokenAmountScaled.mul(divScale).div(tokenAmount);
    return effectivePrice
      .mul(wadScale)
      .div(parseUnits(Number(swapReturn.marketSpNormalised).toFixed(18)))
      .sub(ONE);
  }

  function txHandler(tx: TransactionResponse, action: TransactionAction): void {
    confirming.value = false;

    let summary = '';
    const tokenInAmountFormatted = fNum2(tokenInAmountInput.value, {
      ...FNumFormats.token,
      maximumSignificantDigits: 6,
    });
    const tokenOutAmountFormatted = fNum2(tokenOutAmountInput.value, {
      ...FNumFormats.token,
      maximumSignificantDigits: 6,
    });

    const tokenInSymbol = tokenIn.value.symbol;
    const tokenOutSymbol = tokenOut.value.symbol;

    if (['wrap', 'unwrap'].includes(action)) {
      summary = t('transactionSummary.wrapUnwrap', [
        tokenInAmountFormatted,
        tokenInSymbol,
        tokenOutSymbol,
      ]);
    } else {
      summary = `${tokenInAmountFormatted} ${tokenInSymbol} -> ${tokenOutAmountFormatted} ${tokenOutSymbol}`;
    }

    addTransaction({
      id: tx.hash,
      type: 'tx',
      action,
      summary,
      details: {
        tokenIn: tokenIn.value,
        tokenOut: tokenOut.value,
        tokenInAddress: tokenInAddressInput.value,
        tokenOutAddress: tokenOutAddressInput.value,
        tokenInAmount: tokenInAmountInput.value,
        tokenOutAmount: tokenOutAmountInput.value,
        exactIn: exactIn.value,
        quote: getQuote(),
        priceImpact: priceImpact.value,
        slippageBufferRate: slippageBufferRate.value,
      },
    });

    const tradeUSDValue =
      toFiat(tokenInAmountInput.value, tokenInAddressInput.value) || '0';

    txListener(tx, {
      onTxConfirmed: () => {
        trackGoal(
          Goals.Swapped,
          bnum(tradeUSDValue).times(100).toNumber() || 0
        );
        trading.value = false;
        latestTxHash.value = tx.hash;
      },
      onTxFailed: () => {
        trading.value = false;
      },
    });
  }

  async function trade(successCallback?: () => void) {
    trackGoal(Goals.ClickSwap);
    trading.value = true;
    confirming.value = true;
    state.submissionError = null;

    const tokenInAddress = tokenInAddressInput.value;
    const tokenOutAddress = tokenOutAddressInput.value;
    const tokenInDecimals = getToken(tokenInAddress).decimals;
    const tokenOutDecimals = getToken(tokenOutAddress).decimals;
    const tokenInAmountScaled = parseFixed(
      tokenInAmountInput.value,
      tokenInDecimals
    );

    if (wrapType.value == WrapType.Wrap) {
      try {
        const tx = await wrap(
          appNetworkConfig.key,
          provider.value as any,
          tokenOutAddress,
          tokenInAmountScaled
        );
        console.log('Wrap tx', tx);

        txHandler(tx, 'wrap');

        if (successCallback != null) {
          successCallback();
        }
        trackSwapEvent();
      } catch (e) {
        console.log(e);
        captureException(e);
        state.submissionError = (e as Error).message;
        trading.value = false;
        confirming.value = false;
      }
      return;
    } else if (wrapType.value == WrapType.Unwrap) {
      try {
        const tx = await unwrap(
          appNetworkConfig.key,
          provider.value as any,
          tokenInAddress,
          tokenInAmountScaled
        );
        console.log('Unwrap tx', tx);

        txHandler(tx, 'unwrap');

        if (successCallback != null) {
          successCallback();
        }
        trackSwapEvent();
      } catch (e) {
        console.log(e);
        captureException(e);
        state.submissionError = (e as Error).message;
        trading.value = false;
        confirming.value = false;
      }
      return;
    }

    if (exactIn.value) {
      const tokenOutAmount = parseFixed(
        tokenOutAmountInput.value,
        tokenOutDecimals
      );
      const minAmount = getMinOut(tokenOutAmount);
      const sr: SorReturn = sorReturn.value as SorReturn;

      try {
        const tx = await swapIn(sr, tokenInAmountScaled, minAmount);
        console.log('Swap in tx', tx);

        txHandler(tx, 'trade');

        if (successCallback != null) {
          successCallback();
        }
        trackSwapEvent();
      } catch (e) {
        console.log(e);
        captureException(e);
        state.submissionError = (e as Error).message;
        trading.value = false;
        confirming.value = false;
      }
    } else {
      const tokenInAmountMax = getMaxIn(tokenInAmountScaled);
      const sr: SorReturn = sorReturn.value as SorReturn;
      const tokenOutAmountScaled = parseFixed(
        tokenOutAmountInput.value,
        tokenOutDecimals
      );

      try {
        const tx = await swapOut(sr, tokenInAmountMax, tokenOutAmountScaled);
        console.log('Swap out tx', tx);

        txHandler(tx, 'trade');

        if (successCallback != null) {
          successCallback();
        }
        trackSwapEvent();
      } catch (e) {
        console.log(e);
        captureException(e);
        state.submissionError = (e as Error).message;
        trading.value = false;
        confirming.value = false;
      }
    }
  }

  // Uses stored market prices to calculate price of native asset in terms of token
  function calculateEthPriceInToken(tokenAddress: string): number {
    const ethPriceFiat = priceFor(appNetworkConfig.nativeAsset.address);
    const tokenPriceFiat = priceFor(tokenAddress);
    if (tokenPriceFiat === 0) return 0;
    const ethPriceToken = ethPriceFiat / tokenPriceFiat;
    return ethPriceToken;
  }

  // Sets SOR swap cost for more efficient routing
  async function setSwapCost(
    tokenAddress: string,
    tokenDecimals: number,
    sorManager: SorManager
  ): Promise<void> {
    await sorManager.setCostOutputToken(
      tokenAddress,
      tokenDecimals,
      calculateEthPriceInToken(tokenAddress).toString()
    );
  }

  function getMaxIn(amount: BigNumber) {
    return amount
      .mul(parseFixed(String(1 + slippageBufferRate.value), 18))
      .div(ONE);
  }

  function getMinOut(amount: BigNumber) {
    return amount
      .mul(ONE)
      .div(parseFixed(String(1 + slippageBufferRate.value), 18));
  }

  function getQuote(): TradeQuote {
    const maximumInAmount =
      tokenInAmountScaled != null ? getMaxIn(tokenInAmountScaled.value) : Zero;

    const minimumOutAmount =
      tokenOutAmountScaled != null
        ? getMinOut(tokenOutAmountScaled.value)
        : Zero;

    return {
      feeAmountInToken: '0',
      feeAmountOutToken: '0',
      maximumInAmount,
      minimumOutAmount,
    };
  }

  function formatAmount(amount: string) {
    return fNum2(amount, {
      maximumSignificantDigits: 6,
      useGrouping: false,
      fixedFormat: true,
    });
  }

  function getTokenDecimals(tokenAddress: string) {
    return getToken(tokenAddress)?.decimals;
  }

  /**
   * Under certain circumstance we need to adjust an amount
   * for the price impact calc due to background wrapping taking place
   * e.g. when trading weth to wstEth.
   */
  async function adjustedPiAmount(
    amount: BigNumber,
    address: string,
    isWrap = true
  ): Promise<BigNumber> {
    if (
      isSameAddress(address, appNetworkConfig.addresses.wstETH) &&
      isMainnet.value
    ) {
      return convertStEthWrap({ amount, isWrap });
    }
    return amount;
  }

  return {
    ...toRefs(state),
    sorManager,
    sorReturn,
    pools,
    initSor,
    handleAmountChange,
    exactIn,
    trade,
    trading,
    priceImpact,
    latestTxHash,
    fetchPools,
    poolsLoading,
    getQuote,
    resetState,
    confirming,
    updateTradeAmounts,
    resetInputAmounts,
    // For Tests
    setSwapCost,
  };
}
