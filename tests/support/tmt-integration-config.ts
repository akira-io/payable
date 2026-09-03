const REQUIRED_VARIABLES = [
  'TMT_PATH',
  'TMT_API_TOKEN',
  'TMT_CHANNEL_ID',
  'TMT_CHANNEL_SECRET',
] as const;

type RequiredVariable = (typeof REQUIRED_VARIABLES)[number];
type IntegrationEnvironment = Partial<Record<RequiredVariable, string | undefined>>;

export interface TmtIntegrationConfig {
  path: string;
  apiToken: string;
  channelId: number;
  channelSecret: string;
}

export type TmtIntegrationConfigResolution =
  | { kind: 'skip'; reason: string }
  | { kind: 'ready'; config: TmtIntegrationConfig };

export interface TmtReadinessChannel {
  id: number;
  account_mode: string;
  currencies: string;
}

export function resolveTmtIntegrationConfig(
  environment: IntegrationEnvironment,
): TmtIntegrationConfigResolution {
  const present = REQUIRED_VARIABLES.filter((name) => Boolean(environment[name]?.trim()));
  if (present.length === 0) {
    return {
      kind: 'skip',
      reason: `TMT integration skipped: set ${formatVariableList(REQUIRED_VARIABLES)}`,
    };
  }

  const missing = REQUIRED_VARIABLES.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Incomplete TMT integration configuration; missing ${missing.join(', ')}`);
  }

  const channelId = Number(environment.TMT_CHANNEL_ID);
  if (!Number.isInteger(channelId) || channelId <= 0) {
    throw new Error('TMT_CHANNEL_ID must be a positive integer');
  }

  return {
    kind: 'ready',
    config: {
      path: environment.TMT_PATH as string,
      apiToken: environment.TMT_API_TOKEN as string,
      channelId,
      channelSecret: environment.TMT_CHANNEL_SECRET as string,
    },
  };
}

export function assertTmtTestChannel(
  channel: TmtReadinessChannel,
  configuredChannelId: number,
): { channelId: number; currency: string } {
  if (channel.id !== configuredChannelId) {
    throw new Error('TMT readiness returned a different configured channel identity');
  }
  if (channel.account_mode !== 'test') {
    throw new Error('TMT integration refusing a non-test channel mode');
  }
  const currency = channel.currencies.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw new Error('TMT readiness returned an invalid channel currency');
  }
  return { channelId: channel.id, currency };
}

function formatVariableList(names: readonly string[]): string {
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
