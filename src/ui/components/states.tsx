/** Loading and error states, shared by the shell and the views. */
import { ApiError } from "../api";
import { S } from "../strings";

export function Loading({ label = S.loading }: { label?: string }) {
	return (
		<div className="state" role="status" aria-live="polite">
			<p>{label}</p>
			<div className="loading-line" />
		</div>
	);
}

export function errorMessage(error: unknown): string {
	if (error instanceof ApiError)
		return `${error.status} ${error.body.error}: ${error.body.message}`;
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * An error answer of the server (it did answer) or no answer at all (the server is not running):
 * the title says which.
 */
export function ErrorView({
	error,
	retry,
	title,
}: {
	error: unknown;
	retry?: () => void;
	title?: string;
}) {
	const answered = error instanceof ApiError;
	return (
		<div className="state" role="alert">
			<h2>{title ?? (answered ? S.errorTitleServer : S.errorTitle)}</h2>
			<p>{answered ? S.errorHintServer : S.errorHint}</p>
			<pre>{errorMessage(error)}</pre>
			{retry ? (
				<div className="actions">
					<button type="button" className="btn" onClick={retry}>
						{S.retry}
					</button>
				</div>
			) : null}
		</div>
	);
}
