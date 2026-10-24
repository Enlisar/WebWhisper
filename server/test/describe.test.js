import test from 'node:test';
import assert from 'node:assert/strict';
import { composeLocal } from '../../extension/lib/describe.js';

test('describe: text box with typed content', () => {
  const info = {
    kind: 'input',
    fieldType: 'text',
    label: 'Username',
    value: 'johndoe',
  };
  const speech = composeLocal(info);
  assert.match(speech, /Text box for “Username”/);
  assert.match(speech, /It currently says: “johndoe”/);
});

test('describe: search box empty with placeholder', () => {
  const info = {
    kind: 'input',
    fieldType: 'search',
    isSearch: true,
    label: 'Search store',
    placeholder: 'Search products and brands',
  };
  const speech = composeLocal(info);
  assert.match(speech, /Search box for “Search store”/);
  assert.match(speech, /It is empty/);
  assert.match(speech, /Placeholder says: “Search products and brands”/);
  assert.match(speech, /Type keywords to search/);
});

test('describe: password field (sensitive)', () => {
  const info = {
    kind: 'input',
    fieldType: 'password',
    label: 'Account Password',
    sensitive: true,
    filled: true,
    required: true,
  };
  const speech = composeLocal(info);
  assert.match(speech, /Password field for “Account Password”/);
  assert.match(speech, /It already has something typed in, which I won’t read out/);
  assert.match(speech, /Required/);
});

test('describe: button - submit action', () => {
  const info = {
    kind: 'button',
    label: 'Send message',
    buttonType: 'submit',
    formInfo: 'Contact Us',
  };
  const speech = composeLocal(info);
  assert.match(speech, /Button “Send message”/);
  assert.match(speech, /Submits the Contact Us form/);
});

test('describe: button - menu popup and disabled', () => {
  const info = {
    kind: 'button',
    label: 'Options',
    hasPopup: 'menu',
    disabled: true,
  };
  const speech = composeLocal(info);
  assert.match(speech, /Button “Options”/);
  assert.match(speech, /currently disabled/);
});

test('describe: button - inferred action', () => {
  const info = {
    kind: 'button',
    label: 'Add to Cart',
    actionText: 'Adds this item to your cart.',
  };
  const speech = composeLocal(info);
  assert.match(speech, /Button “Add to Cart”/);
  assert.match(speech, /Adds this item to your cart/);
});

test('describe: link - external destination', () => {
  const info = {
    kind: 'link',
    label: 'GitHub Documentation',
    destType: 'external',
    hostname: 'docs.github.com',
    pathname: '/en/get-started',
    targetBlank: true,
  };
  const speech = composeLocal(info);
  assert.match(speech, /Link “GitHub Documentation”/);
  assert.match(speech, /external website docs\.github\.com/);
  assert.match(speech, /Opens in a new tab/);
});

test('describe: link - in-page anchor', () => {
  const info = {
    kind: 'link',
    label: 'Customer Reviews',
    destType: 'anchor',
    anchorName: 'reviews',
  };
  const speech = composeLocal(info);
  assert.match(speech, /Link “Customer Reviews”/);
  assert.match(speech, /Jumps to the reviews section on this page/);
});

test('describe: link - email and phone', () => {
  const emailLink = composeLocal({
    kind: 'link',
    label: 'Support',
    destType: 'email',
    email: 'help@example.com',
  });
  assert.match(emailLink, /Opens email to help@example\.com/);

  const phoneLink = composeLocal({
    kind: 'link',
    label: 'Call us',
    destType: 'phone',
    phone: '+1-800-555-0199',
  });
  assert.match(phoneLink, /Calls phone number \+1-800-555-0199/);
});

test('describe: heading and text blocks', () => {
  const heading = composeLocal({
    kind: 'heading',
    level: 1,
    text: 'Welcome to WebWhisper',
  });
  assert.equal(heading, 'Heading level 1: “Welcome to WebWhisper”.');

  const paragraph = composeLocal({
    kind: 'text',
    tag: 'p',
    text: 'A Chrome side-panel assistant for blind and low-vision users.',
  });
  assert.equal(paragraph, 'A Chrome side-panel assistant for blind and low-vision users.');

  const quote = composeLocal({
    kind: 'text',
    tag: 'blockquote',
    text: 'Accessibility is essential.',
  });
  assert.equal(quote, 'Quote: “Accessibility is essential.”.'.replace(/\.\./, '.'));
});
