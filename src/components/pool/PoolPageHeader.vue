<script lang="ts" setup>
import { computed, toRef, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import BalChipNew from '@/components/chips/BalChipNew.vue';
import GauntletIcon from '@/components/images/icons/GauntletIcon.vue';
import APRTooltip from '@/components/tooltips/APRTooltip/APRTooltip.vue';
import StakePreviewModal from '@/components/contextual/stake/StakePreviewModal.vue';
import useNumbers from '@/composables/useNumbers';
import { usePoolWarning } from '@/composables/usePoolWarning';
import { usePool } from '@/composables/usePool';
import { useTokens } from '@/providers/tokens.provider';
import { EXTERNAL_LINKS } from '@/constants/links';
import { POOLS } from '@/constants/pools';
import { includesAddress } from '@/lib/utils';
import { Pool, PoolToken } from '@/services/pool/types';
import useWeb3 from '@/services/web3/useWeb3';
import { AprBreakdown } from '@balancer-labs/sdk';
import useStaking from '@/composables/staking/useStaking';

/**
 * TYPES
 */
type Props = {
  loadingPool: boolean;
  loadingApr: boolean;
  noInitLiquidity: boolean;
  isStableLikePool: boolean;
  pool?: Pool;
  poolApr?: AprBreakdown;
  titleTokens: PoolToken[];
  missingPrices: boolean;
  isLiquidityBootstrappingPool: boolean;
  isComposableStableLikePool: boolean;
};

const props = withDefaults(defineProps<Props>(), {
  loadingPool: true,
  loadingApr: true,
  noInitLiquidity: false,
  pool: undefined,
  poolApr: undefined,
});

const poolId = computed(() => toRef(props, 'pool').value.id);

/**
 * COMPOSABLES
 */
const { isAffected, warnings } = usePoolWarning(poolId);
const { hasNonApprovedRateProviders } = usePool(toRef(props, 'pool'));
const { fNum2 } = useNumbers();
const { t } = useI18n();
const { explorerLinks: explorer } = useWeb3();
const { balancerTokenListTokens } = useTokens();
const {
  userData: { hasNonPrefGaugeBalances },
} = useStaking();

/**
 * STATE
 */
const isRestakePreviewVisible = ref(false);

/**
 * COMPUTED
 */
const feesFixed = computed(() => props.pool?.owner == POOLS.ZeroAddress);

const communityManagedFees = computed(
  () => props.pool?.owner == POOLS.DelegateOwner
);
const feesManagedByGauntlet = computed(
  () =>
    communityManagedFees.value &&
    POOLS.DynamicFees.Gauntlet.includes(props.pool.id)
);
const swapFeeToolTip = computed(() => {
  if (feesManagedByGauntlet.value) {
    return t('feesManagedByGauntlet');
  } else if (communityManagedFees.value) {
    return t('delegateFeesTooltip');
  } else if (feesFixed.value) {
    return t('fixedFeesTooltip');
  } else {
    return t('ownerFeesTooltip');
  }
});

const poolFeeLabel = computed(() => {
  if (!props.pool || !props.pool?.swapFee) return '';

  const feeLabel = `${fNum2(props.pool.swapFee, {
    style: 'percent',
    maximumFractionDigits: 4,
  })}`;

  if (feesFixed.value) {
    return t('fixedSwapFeeLabel', [feeLabel]);
  } else if (communityManagedFees.value) {
    return feesManagedByGauntlet.value
      ? t('dynamicSwapFeeLabel', [feeLabel])
      : t('communitySwapFeeLabel', [feeLabel]);
  }

  // Must be owner-controlled
  return t('dynamicSwapFeeLabel', [feeLabel]);
});

const hasCustomToken = computed(() => {
  const knownTokens = Object.keys(balancerTokenListTokens.value);
  return (
    !!props.pool &&
    !props.isLiquidityBootstrappingPool &&
    !props.isComposableStableLikePool &&
    props.pool.tokensList.some(
      address => !includesAddress(knownTokens, address)
    )
  );
});

const poolTypeLabel = computed(() => {
  if (!props.pool?.factory) return '';
  const key = POOLS.Factories[props.pool.factory];

  return key ? t(key) : t('unknownPoolType');
});
</script>

<template>
  <div class="col-span-2 px-4 lg:px-0">
    <BalLoadingBlock v-if="loadingPool || !pool" class="header-loading-block" />
    <div v-else class="flex flex-col">
      <div class="flex flex-wrap items-center -mt-2">
        <div v-if="POOLS.Metadata[pool?.id]">
          <h3 class="pool-title">
            {{ POOLS.Metadata[pool.id].name }}
          </h3>
          <h5 class="text-sm">
            {{ poolTypeLabel }}
          </h5>
        </div>
        <h3 v-else class="pool-title">
          {{ poolTypeLabel }}
        </h3>
        <div
          v-for="({ address, symbol, weight }, i) in titleTokens"
          :key="i"
          class="flex items-center px-2 mt-2 mr-2 h-10 bg-gray-50 dark:bg-gray-850 rounded-lg"
        >
          <BalAsset :address="address" />
          <span class="ml-2">
            {{ symbol }}
          </span>
          <span
            v-if="!isStableLikePool"
            class="mt-px ml-1 text-xs font-medium text-gray-400"
          >
            {{
              fNum2(weight || '0', {
                style: 'percent',
                maximumFractionDigits: 0,
              })
            }}
          </span>
        </div>
        <BalChipNew v-if="pool?.isNew" class="mt-2 mr-2" />
        <APRTooltip
          v-if="!loadingApr"
          :pool="pool"
          :poolApr="poolApr"
          class="mt-1 -ml-1"
        />
        <BalLink
          :href="explorer.addressLink(pool?.address || '')"
          external
          noStyle
          class="flex items-center"
        >
          <BalIcon
            name="arrow-up-right"
            size="sm"
            class="mt-2 ml-2 text-gray-500 hover:text-blue-500 transition-colors"
          />
        </BalLink>
      </div>
      <div class="flex items-center mt-2">
        <div class="mr-1 text-sm text-secondary" v-html="poolFeeLabel" />
        <BalTooltip>
          <template #activator>
            <BalLink
              v-if="feesManagedByGauntlet"
              :href="EXTERNAL_LINKS.Gauntlet.Home"
              external
            >
              <GauntletIcon />
            </BalLink>
            <BalIcon
              v-else
              name="info"
              size="xs"
              class="text-gray-400 dark:text-gray-500"
            />
          </template>
          <span>
            {{ swapFeeToolTip }}
          </span>
        </BalTooltip>
      </div>
    </div>

    <BalAlert
      v-if="hasNonApprovedRateProviders"
      type="warning"
      :title="$t('hasNonApprovedRateProviders')"
      class="mt-2"
      block
    />
    <BalAlert
      v-if="!loadingPool && missingPrices"
      type="warning"
      :title="$t('noPriceInfo')"
      class="mt-2"
      block
    />
    <BalAlert
      v-if="!loadingPool && hasCustomToken"
      type="error"
      :title="$t('highRiskPool')"
      class="mt-2"
      block
    />
    <BalAlert
      v-if="hasNonPrefGaugeBalances && !isAffected"
      :title="$t('staking.restakeGauge')"
      :type="'warning'"
      class="mt-2"
    >
      <BalStack spacing="sm">
        <span>{{ $t('staking.restakeGaugeDescription') }}</span>
        <div>
          <BalBtn
            :color="'gradient'"
            class="p-2"
            :size="'sm'"
            @click="isRestakePreviewVisible = true"
          >
            {{ $t('restake') }}
          </BalBtn>
        </div>
      </BalStack>
    </BalAlert>
    <template v-if="!loadingPool && isAffected">
      <BalAlert
        v-for="(warning, i) in warnings"
        :key="`warning-${i}`"
        type="error"
        class="mt-2"
        block
      >
        <template #title>
          <div v-html="warning.title" />
        </template>
        <template #description>
          <div v-html="warning.description" />
        </template>
      </BalAlert>
    </template>
    <BalAlert
      v-if="noInitLiquidity"
      type="warning"
      :title="$t('noInitLiquidity')"
      :description="$t('noInitLiquidityDetail')"
      class="mt-2"
      block
    />
    <StakePreviewModal
      v-if="!!pool"
      :isVisible="isRestakePreviewVisible"
      :pool="pool"
      :action="'restake'"
      @close="isRestakePreviewVisible = false"
      @success="isRestakePreviewVisible = false"
    />
  </div>
</template>
<style scoped>
.pool-title {
  @apply mr-4 capitalize mt-2;

  font-variation-settings: 'wght' 700;
}

.header-loading-block {
  height: 4.249rem;
}
</style>
