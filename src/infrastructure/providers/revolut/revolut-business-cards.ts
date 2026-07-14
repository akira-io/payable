import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateIssuingCardInput,
  IssuingCardDTO,
  IssuingCardStatus,
  ListIssuingCardsInput,
} from '../../../domain/dtos/issuing.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { revolutBusinessAmount } from './revolut-business-amounts';
import { toRevolutBusinessIssuingCardDTO } from './revolut-business-card-mappers';
import type { RevolutBusinessCard, RevolutBusinessRequest } from './revolut-business-types';

const DEFAULT_LIMIT = 100;
const MAX_PAGE_LIMIT = 100;

export class RevolutBusinessCards {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async create(input: CreateIssuingCardInput, ctx: OperationContext): Promise<IssuingCardDTO> {
    if (input.form === 'physical') {
      throw unsupported('Revolut Business API can create only virtual cards');
    }
    const holderId = input.holderReference ?? input.providerCardholderId;
    const card = await this.request<RevolutBusinessCard>('/cards', {
      method: 'POST',
      body: {
        request_id: ctx.idempotencyKey,
        holder_id: holderId,
        virtual: true,
        label: input.label,
        spending_limits: input.spendingLimit
          ? {
              single: {
                amount: revolutBusinessAmount(input.spendingLimit),
                currency: input.spendingLimit.currency(),
              },
            }
          : undefined,
      },
    });
    return toRevolutBusinessIssuingCardDTO(card);
  }

  async list(input: ListIssuingCardsInput = {}): Promise<IssuingCardDTO[]> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const cards: IssuingCardDTO[] = [];
    let createdBefore: string | undefined;
    while (cards.length < limit) {
      const pageLimit = Math.min(limit - cards.length, MAX_PAGE_LIMIT);
      const query = new URLSearchParams({ limit: String(pageLimit) });
      if (createdBefore) {
        query.set('created_before', createdBefore);
      }
      const page = await this.request<RevolutBusinessCard[]>(`/cards?${query.toString()}`, {
        method: 'GET',
      });
      const mapped = page.map(toRevolutBusinessIssuingCardDTO);
      cards.push(
        ...(input.status ? mapped.filter((card) => card.status === input.status) : mapped),
      );
      if (page.length < pageLimit) {
        break;
      }
      const cursor = page.at(-1)?.created_at;
      if (!cursor || cursor === createdBefore) {
        break;
      }
      createdBefore = cursor;
    }
    return cards.slice(0, limit);
  }

  async retrieve(providerCardId: string): Promise<IssuingCardDTO> {
    return toRevolutBusinessIssuingCardDTO(await this.retrieveCard(providerCardId));
  }

  async update(providerCardId: string, status: IssuingCardStatus): Promise<IssuingCardDTO> {
    const card = await this.retrieveCard(providerCardId);
    if (status === 'canceled') {
      await this.request<null>(`/cards/${encodeURIComponent(providerCardId)}`, {
        method: 'DELETE',
      });
      return { ...toRevolutBusinessIssuingCardDTO(card), status: 'canceled' };
    }
    const operation = cardOperation(card.state, status);
    if (!operation) {
      return toRevolutBusinessIssuingCardDTO(card);
    }
    await this.request<null>(`/cards/${encodeURIComponent(providerCardId)}/${operation}`, {
      method: 'POST',
    });
    return this.retrieve(providerCardId);
  }

  private retrieveCard(providerCardId: string): Promise<RevolutBusinessCard> {
    return this.request<RevolutBusinessCard>(`/cards/${encodeURIComponent(providerCardId)}`, {
      method: 'GET',
    });
  }
}

function cardOperation(current: string, target: IssuingCardStatus): string | null {
  if (target === 'active' && current === 'active') {
    return null;
  }
  if (target === 'active' && current === 'frozen') {
    return 'unfreeze';
  }
  if (target === 'active' && current === 'locked') {
    return 'unlock';
  }
  if (target === 'inactive' && current === 'frozen') {
    return null;
  }
  if (target === 'inactive' && current === 'active') {
    return 'freeze';
  }
  if (target === 'blocked' && current === 'locked') {
    return null;
  }
  if (target === 'blocked' && current === 'active') {
    return 'lock';
  }
  throw unsupported(`Revolut Business cannot change a ${current} card to ${target}`);
}

function unsupported(message: string): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_OPERATION_UNSUPPORTED',
    context: { provider: 'revolut-business-issuing' },
  });
}
