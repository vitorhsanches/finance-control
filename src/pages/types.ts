import type { FinanceState } from "../types";

export interface PageProps {
  state: FinanceState;
  updateState: (updater: (previous: FinanceState) => FinanceState) => void;
  onDeleteFutureBill?: (billId: string) => Promise<void>;
}
