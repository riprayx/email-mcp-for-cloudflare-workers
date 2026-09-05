import assert from "node:assert/strict";
import test from "node:test";
import * as smtpErrors from "../src/mail/smtp-errors.ts";

const { SmtpDeliveryUnknownError, SmtpResponseError, classifySmtpDataFailure } = smtpErrors;

test("explicit SMTP rejection remains a definite response failure", () => {
	const rejection = new SmtpResponseError(550, "mail rejected");
	assert.equal(classifySmtpDataFailure(rejection), rejection);
});

test("transport failure after DATA becomes unknown delivery state", () => {
	const result = classifySmtpDataFailure(new Error("SMTP connection closed"));
	assert.equal(result instanceof SmtpDeliveryUnknownError, true);
	assert.match(result.message, /delivery state is unknown/i);
	assert.match(result.message, /do not retry automatically/i);
});

test("unknown DATA outcome is returned as a non-retryable structured result", () => {
	const makeResult = (
		smtpErrors as typeof smtpErrors & {
			smtpDataFailureResult?: (error: unknown, messageId?: string) => unknown;
		}
	).smtpDataFailureResult;
	const result = makeResult?.(new Error("SMTP connection closed"), "<message@example.com>");
	assert.deepEqual(result, {
		messageId: "<message@example.com>",
		accepted: [],
		rejected: [],
		deliveryState: "unknown",
		deliveryWarning:
			"SMTP delivery state is unknown after message data was transmitted; do not retry automatically. SMTP connection closed",
	});
});
