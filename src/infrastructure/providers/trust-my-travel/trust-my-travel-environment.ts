import { PayableError } from '../../../domain/errors/payable-error';
import {
  TRUST_MY_TRAVEL_ENVIRONMENT_BY_ACCOUNT_MODE,
  type TrustMyTravelEnvironment,
} from './trust-my-travel-types';

export function resolveTrustMyTravelEnvironment(accountMode: string): TrustMyTravelEnvironment {
  const environment = TRUST_MY_TRAVEL_ENVIRONMENT_BY_ACCOUNT_MODE[accountMode];

  if (!environment) {
    throw new PayableError('Trust My Travel channel mode is not supported', {
      code: 'PROVIDER_TMT_CHANNEL_MODE_UNSUPPORTED',
      context: { provider: 'trust-my-travel', accountMode },
    });
  }

  return environment;
}
