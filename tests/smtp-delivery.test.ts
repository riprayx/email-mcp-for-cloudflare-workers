import assert from "node:assert/strict";
import test from "node:test";
import {
	SmtpDeliveryUnknownError,
	SmtpResponseError,
	classifySmtpDataFailure,
} from "../src/mail/smtp-errors";

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
