export interface SupabaseCall {
  table: string;
  operation: string;
  payload?: unknown;
  options?: unknown;
  filters: Array<[string, unknown]>;
}

export interface SupabaseResult {
  data?: any;
  error?: any;
  count?: number | null;
}

type Resolver = (call: SupabaseCall) => SupabaseResult | Promise<SupabaseResult>;

class QueryBuilder implements PromiseLike<SupabaseResult> {
  private operation = 'select';
  private payload?: unknown;
  private options?: unknown;
  private filters: Array<[string, unknown]> = [];

  constructor(
    private table: string,
    private resolveCall: Resolver,
    private calls: SupabaseCall[]
  ) {}

  select(_columns?: string, options?: unknown) {
    this.operation = 'select';
    this.options = options;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: unknown) {
    this.options = { column, ...((options || {}) as object) };
    return this;
  }

  maybeSingle() {
    this.operation = 'maybeSingle';
    return this;
  }

  upsert(payload: unknown, options?: unknown) {
    this.operation = 'upsert';
    this.payload = payload;
    this.options = options;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  insert(payload: unknown) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  then<TResult1 = SupabaseResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const call: SupabaseCall = {
      table: this.table,
      operation: this.operation,
      payload: this.payload,
      options: this.options,
      filters: [...this.filters]
    };
    this.calls.push(call);
    return Promise.resolve(this.resolveCall(call)).then(onfulfilled, onrejected);
  }
}

export function createSupabaseMock(initialResolver?: Resolver) {
  const calls: SupabaseCall[] = [];
  let resolver: Resolver = initialResolver || (() => ({ data: [], error: null, count: 0 }));

  const auth = {
    getSession: async () => ({ data: { session: null } }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  };

  const client = {
    auth,
    from(table: string) {
      return new QueryBuilder(table, (call) => resolver(call), calls);
    }
  };

  return {
    client,
    auth,
    calls,
    setResolver(nextResolver: Resolver) {
      resolver = nextResolver;
    },
    reset() {
      calls.length = 0;
      resolver = () => ({ data: [], error: null, count: 0 });
    }
  };
}
