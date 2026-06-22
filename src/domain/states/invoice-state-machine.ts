import type { InvoiceStatus } from '../value-objects/invoice-status';
import { applyTransition, canTransition, type TransitionMap } from './transition';

export type InvoiceEvent = 'finalize' | 'pay' | 'mark_uncollectible' | 'void';

const MAP: TransitionMap<InvoiceStatus, InvoiceEvent> = {
  draft: { finalize: 'open', void: 'void' },
  open: { pay: 'paid', mark_uncollectible: 'uncollectible', void: 'void' },
  uncollectible: { pay: 'paid' },
};

export class InvoiceStateMachine {
  constructor(private state: InvoiceStatus = 'draft') {}

  current(): InvoiceStatus {
    return this.state;
  }

  can(event: InvoiceEvent): boolean {
    return canTransition(MAP, this.state, event);
  }

  private to(event: InvoiceEvent): this {
    this.state = applyTransition('invoice', MAP, this.state, event);
    return this;
  }

  finalize(): this {
    return this.to('finalize');
  }

  pay(): this {
    return this.to('pay');
  }

  markUncollectible(): this {
    return this.to('mark_uncollectible');
  }

  voidInvoice(): this {
    return this.to('void');
  }
}
