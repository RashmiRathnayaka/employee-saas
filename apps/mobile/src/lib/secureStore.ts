import * as SecureStore from "expo-secure-store";

// expo-secure-store wraps the OS keychain/keystore - see CLAUDE.md's rule
// that mobile tokens never touch AsyncStorage/plain files.
const ACCESS_TOKEN_KEY = "auth.accessToken";
const REFRESH_TOKEN_KEY = "auth.refreshToken";
const LAST_COMPANY_CODE_KEY = "auth.lastCompanyCode";

export async function getTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  return { accessToken, refreshToken };
}

export async function setTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)]);
}

// Only the company code is remembered for next time (never the password) -
// see docs/prompts/step-1.6.md's 1.6a login requirements.
export async function getLastCompanyCode(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_COMPANY_CODE_KEY);
}

export async function setLastCompanyCode(code: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_COMPANY_CODE_KEY, code);
}
