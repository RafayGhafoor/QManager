/** A mutator's outcome, returned so a handler never reads hook `error` state after an `await`. */
export interface MutationResult {
  ok: boolean;
  /** The CGI's error slug (`errors.json` key); null on success or a transport failure. */
  code: string | null;
  /** Untranslated failure detail; null on success or when the component unmounted mid-call. */
  error: string | null;
}
