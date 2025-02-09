<script setup lang="ts">
import { orderBy } from 'lodash';
import { computed, reactive, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import TokenListItem from '@/components/lists/TokenListItem.vue';
import TokenListsListItem from '@/components/lists/TokenListsListItem.vue';
import { useTokenLists } from '@/providers/token-lists.provider';
import { useTokens } from '@/providers/tokens.provider';
import useUrls from '@/composables/useUrls';
import { TokenInfoMap, TokenList } from '@/types/TokenList';
import Search from './Search.vue';

interface Props {
  open?: boolean;
  excludedTokens?: string[];
  subset?: string[];
  includeEther?: boolean;
  disableInjection?: boolean;
  hideTokenLists?: boolean;
  ignoreBalances?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  excludedTokens: () => [],
  subset: () => [],
  includeEther: false,
  disableInjection: false,
  hideTokenLists: false,
  ignoreBalances: false,
});

const emit = defineEmits(['close', 'selectTokenlist', 'select']);

interface ComponentState {
  loading: boolean;
  selectTokenList: boolean;
  query: string;
  results: TokenInfoMap;
}

/**
 * STATE
 */
const state: ComponentState = reactive({
  loading: false,
  selectTokenList: false,
  query: '',
  results: {},
});

/**
 * COMPOSABLES
 */
const { activeTokenLists, approvedTokenLists, toggleTokenList, isActiveList } =
  useTokenLists();
const {
  getToken,
  searchTokens,
  priceFor,
  balanceFor,
  dynamicDataLoading,
  nativeAsset,
  injectTokens,
} = useTokens();
const { t } = useI18n();
const { resolve } = useUrls();

/**
 * COMPUTED
 */
const title = computed(() => {
  if (state.selectTokenList) return t('manageLists');
  return t('tokenSearch');
});

const tokenLists = computed<Record<string, TokenList>>(() => {
  const query = state.query.toLowerCase();
  const tokenListArray = Object.entries(approvedTokenLists.value);
  const results = tokenListArray.filter(([, tokenList]) =>
    tokenList.name.toLowerCase().includes(query)
  );
  return Object.fromEntries(results);
});

const tokens = computed(() => {
  const tokensWithValues = Object.values(state.results).map(token => {
    const balance = balanceFor(token.address);
    const price = priceFor(token.address);
    const value = Number(balance) * price;
    return {
      ...token,
      price,
      balance,
      value,
    };
  });

  if (props.ignoreBalances) return tokensWithValues;
  else return orderBy(tokensWithValues, ['value', 'balance'], ['desc', 'desc']);
});

const excludedTokens = computed(() => [
  ...props.excludedTokens,
  ...(props.includeEther ? [] : [nativeAsset.address]),
]);

/**
 * METHODS
 */
async function onSelectToken(token: string): Promise<void> {
  if (!getToken(token)) {
    await injectTokens([token]);
  }

  emit('select', token);
  emit('close');
}

async function onToggleList(uri: string): Promise<void> {
  toggleTokenList(uri);
  state.results = await searchTokens(state.query, {
    excluded: excludedTokens.value,
    disableInjection: props.disableInjection,
    subset: props.subset,
  });
}

function onListExit(): void {
  state.selectTokenList = false;
  state.query = '';
}

function toggleSelectTokenList(): void {
  state.selectTokenList = !state.selectTokenList;
  state.query = '';
}

/**
 * WATCHERS
 */
watch(
  toRef(state, 'query'),
  async newQuery => {
    state.loading = true;
    state.results = await searchTokens(newQuery, {
      excluded: excludedTokens.value,
      disableInjection: props.disableInjection,
      subset: props.subset,
    }).finally(() => {
      state.loading = false;
    });
  },
  { immediate: true }
);
</script>

<template>
  <BalModal show noContentPad @close="$emit('close')">
    <template #header>
      <div class="flex justify-between items-center w-full">
        <div class="flex items-center">
          <BalBtn
            v-if="state.selectTokenList"
            color="gray"
            size="xs"
            class="mr-2"
            flat
            circle
            @click="onListExit"
          >
            <BalIcon name="arrow-left" size="sm" />
          </BalBtn>
          <h5>{{ title }}</h5>
        </div>
        <div
          v-if="!state.selectTokenList && !hideTokenLists"
          class="group flex items-center cursor-pointer"
          @click="toggleSelectTokenList"
        >
          <span class="text-xs text-secondary">{{ $t('tokenLists') }}</span>
          <div class="flex items-center ml-2">
            <span class="mr-1">
              <img
                v-for="(tokenlist, i) in activeTokenLists"
                :key="i"
                :src="resolve(tokenlist.logoURI || '')"
                class="inline-block w-6 h-6 bg-white rounded-full shadow"
              />
            </span>
            <BalIcon
              name="chevron-down"
              size="sm"
              class="ml-1 text-blue-500 group-hover:text-pink-500 group-focus:text-pink-500 dark:text-blue-400 transition-all duration-200 ease-out"
            />
          </div>
        </div>
      </div>
    </template>
    <template v-if="state.selectTokenList">
      <Search
        v-model="state.query"
        :placeholder="$t('searchByName')"
        class="flex-auto py-3 px-4 border-b dark:border-gray-700"
      />
      <div>
        <div
          v-if="Object.keys(tokenLists).length > 0"
          class="overflow-y-scroll h-96"
        >
          <TokenListsListItem
            v-for="(tokenList, uri) in tokenLists"
            :key="uri"
            :isActive="isActiveList(uri.toString())"
            :tokenlist="tokenList"
            :uri="uri"
            @toggle="onToggleList(uri.toString())"
          />
        </div>
        <div
          v-else
          class="flex justify-center items-center h-96"
          v-text="$t('errorNoLists')"
        />
      </div>
    </template>
    <template v-else>
      <div class="flex border-b dark:border-gray-700">
        <Search
          v-model="state.query"
          :placeholder="$t('searchBy')"
          class="flex-auto py-3 px-4"
        />
      </div>
      <div class="overflow-hidden rounded-lg">
        <RecycleScroller
          v-if="tokens.length > 0"
          v-slot="{ item: token }"
          class="overflow-y-scroll list-height"
          :items="tokens"
          :itemSize="64"
          keyField="address"
          :buffer="100"
        >
          <a @click="onSelectToken(token.address)">
            <TokenListItem
              :token="token"
              :hideBalance="ignoreBalances"
              :balanceLoading="dynamicDataLoading"
            />
          </a>
        </RecycleScroller>
        <div
          v-else-if="state.loading"
          class="flex justify-center items-center h-96"
        >
          <BalLoadingIcon />
        </div>
        <div
          v-else
          class="p-12 h-96 text-center text-secondary"
          v-text="$t('errorNoTokens')"
        />
      </div>
    </template>
  </BalModal>
</template>

<style scoped>
.list-height {
  height: 70vh;
}
</style>


