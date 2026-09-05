export class SmtpResponseError extends Error {
	readonly code: number;

	constructor(code: number, message: string) {
		super(message);
		this.name = "SmtpResponseError";
		this.code = code;
	}
}

export class SmtpDeliveryUnknownError extends Error {
	readonly originalError: unknown;

	constructor(originalError: unknown) {
		const detail = originalError instanceof Error ? originalError.message : String(originalError);
		super(
			`SMTP delivery state is unknown after message data was transmitted; do not retry automatically. ${detail}`,
		);
		this.name = "SmtpDeliveryUnknownError";
		this.originalError = originalError;
	}
}

export function classifySmtpDataFailure(error: unknown): Error {
	return error instanceof SmtpResponseError ? error : new SmtpDeliveryUnknownError(error);
}
