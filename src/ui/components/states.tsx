/** Loading and error states, shared by the shell and the views. */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "../api";
import { S } from "../strings";

export function Loading({ label = S.loading }: { label?: string }) {
	return (
		<Empty className="h-full min-h-60" role="status" aria-live="polite">
			<EmptyHeader>
				<Spinner aria-hidden="true" className="text-muted-foreground" />
				<EmptyDescription>{label}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

/**
 * A full-area message: a title, an explanation and what the reader can do about it (buttons or
 * links). The one shape for "not found", "unknown range" and errors.
 */
export function Notice({
	title,
	children,
	actions,
}: {
	title: string;
	children?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<Empty className="h-full min-h-60" role="alert">
			<EmptyHeader className="max-w-xl">
				<EmptyTitle>{title}</EmptyTitle>
				{children ? <EmptyDescription>{children}</EmptyDescription> : null}
			</EmptyHeader>
			{actions ? <EmptyContent className="flex-row justify-center">{actions}</EmptyContent> : null}
		</Empty>
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
		<Empty className="h-full min-h-60" role="alert">
			<EmptyHeader className="max-w-xl">
				<EmptyTitle>{title ?? (answered ? S.errorTitleServer : S.errorTitle)}</EmptyTitle>
				<EmptyDescription>{answered ? S.errorHintServer : S.errorHint}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="max-w-2xl">
				<pre className="w-full rounded-lg bg-muted px-3 py-2 text-left font-mono text-xs whitespace-pre-wrap text-foreground">
					{errorMessage(error)}
				</pre>
				{retry ? (
					<Button variant="outline" onClick={retry}>
						{S.retry}
					</Button>
				) : null}
			</EmptyContent>
		</Empty>
	);
}
