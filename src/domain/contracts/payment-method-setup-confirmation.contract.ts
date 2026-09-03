import type {
  ConfirmPaymentMethodSetupInput,
  PaymentMethodSetupDTO,
} from '../dtos/payment-method-setup.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface PaymentMethodSetupConfirmationCapable {
  confirmPaymentMethodSetup(input: ConfirmPaymentMethodSetupInput): Promise<PaymentMethodSetupDTO>;
}

export function isPaymentMethodSetupConfirmationCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PaymentMethodSetupConfirmationCapable {
  return (
    typeof (provider as Partial<PaymentMethodSetupConfirmationCapable>)
      .confirmPaymentMethodSetup === 'function'
  );
}
