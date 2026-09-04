export class SmtpResponseError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
		this.name = "SmtpResponseError";
	}
}

export class SmtpDeliveryUnknownError extends Error {
	constructor(readonly originalError: unknown) {
		const detail = originalError instanceof Error ? originalError.message : String(originalError);
		super(
			`SMTP delivery state is unknown after message data was transmitted; do not retry automatically. ${detail}`,
		);
		this.name = "SmtpDeliveryUnknownError";
	}
}

export function classifySmtpDataFailure(error: unknown): Error {
	return error instanceof SmtpResponseError ? error : new SmtpDeliveryUnknownError(error);
}
