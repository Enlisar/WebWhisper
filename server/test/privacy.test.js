import test from 'node:test';
import assert from 'node:assert/strict';
import { maskUtterance, resolveValues, stripTokens } from '../../shared/mask.js';
import { redactText, scrub } from '../../shared/redact.js';

test('the original example: spelled username + quoted password never survive masking', () => {
  const r = maskUtterance('type R-A-H-U-L-3-0-0-0 in Userfield and "HAHAHA" in password and open new site');
  assert.ok(!/RAHUL|R-A-H|HAHAHA/i.test(r.masked), r.masked);
  assert.ok(!/RAHUL|HAHAHA/i.test(r.display), r.display);
  assert.equal(r.secretContext, true);
  assert.equal(Object.values(r.values).sort().join(','), 'HAHAHA,RAHUL3000');
  assert.match(r.masked, /open new site$/);
});

test('"my password is X" is masked', () => {
  const r = maskUtterance('my password is hunter2 please type it in the password field');
  assert.ok(!r.masked.includes('hunter2'));
});

test('"my phone number is X. and continue" is masked and preserved in values', () => {
  const r = maskUtterance('my phone number is 9989288681. and continue');
  assert.ok(!r.masked.includes('9989288681'));
  assert.match(r.masked, /my phone number is \{\{V1\}\}\. and continue/);
  assert.equal(r.values.V1, '9989288681');
  assert.match(r.display, /9989288681/);
  assert.equal(r.secretContext, false);
});

test('direct typing and contact forms without explicit field', () => {
  const r1 = maskUtterance('type 9989288681 and continue');
  assert.equal(r1.values.V1, '9989288681');
  assert.equal(r1.masked, 'type {{V1}} and continue');

  const r2 = maskUtterance('my email is aaron@example.com and continue');
  assert.equal(r2.values.V1, 'aaron@example.com');
  assert.equal(r2.masked, 'my email is {{V1}} and continue');

  const r3 = maskUtterance('9989288681 and continue');
  assert.equal(r3.values.V1, '9989288681');
  assert.equal(r3.masked, '{{V1}} and continue');
});

test('typed text in a normal field is masked but displayed', () => {
  const r = maskUtterance('type hello world in the search box');
  assert.ok(!r.masked.includes('hello world'));
  assert.equal(r.secretContext, false);
  assert.match(r.display, /hello world/);
});

test('ordinary commands are untouched', () => {
  for (const t of ['open the gallery', 'click login', "what's on the 'about' page", 'how many sections are there', 'fill the form']) {
    assert.equal(maskUtterance(t).masked, t);
  }
});

test('resolve + strip', () => {
  const v = { V1: 'abc' };
  assert.equal(resolveValues('x {{V1}}', v), 'x abc');
  assert.equal(resolveValues('x {{V9}}', v), null);
  assert.ok(!stripTokens('typed {{V1}}').includes('{{'));
});

test('redaction of cards, ids, emails, phones, OTPs, tokens', () => {
  assert.ok(!redactText('card 4111 1111 1111 1111 ok').includes('4111'));
  assert.ok(!redactText('mail me at rahul@example.com').includes('rahul@'));
  assert.ok(!redactText('call +91 98765 43210 now').includes('98765'));
  assert.ok(!redactText('PAN ABCDE1234F').includes('ABCDE1234F'));
  assert.ok(!redactText('Your OTP is 482913').includes('482913'));
  assert.ok(!redactText('key sk_live_abcdef1234567890abcdef1234567890').includes('abcdef1234567890abcdef'));
  assert.equal(redactText('Admissions open from 10-12-2024'), 'Admissions open from 10-12-2024');
});

test('scrub keeps long URL slugs in href but redacts text', () => {
  const o = scrub({ href: 'https://x.com/a-very-long-article-slug-with-2024-numbers-inside', label: 'a@b.co' });
  assert.match(o.href, /long-article-slug/);
  assert.equal(o.label, '[email removed]');
});
