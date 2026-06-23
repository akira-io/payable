export interface ListCursor {
  createdAt: Date;
  id: string;
}

export interface ListOptions {
  limit?: number;
  before?: ListCursor;
}
