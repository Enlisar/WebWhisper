// Local, instant, private description of what is under the pointer (used when the
// optional Gemini narration is off or slow).
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function composeLocal(i) {
  const label = i.label ? `\u201c${i.label}\u201d` : 'with no label';
  switch (i.kind) {
    case 'button':
      return `A button ${i.label ? 'called ' : ''}${label}.${i.disabled ? ' It\u2019s currently disabled.' : ''}${i.inSection ? ` It\u2019s in the ${i.inSection} area.` : ''}`;
    case 'link':
      return `A link ${i.label ? 'called ' : ''}${label}${i.href ? `, which goes to ${i.href.replace(/\//g, ' slash ')}` : ''}.`;
    case 'input': {
      const t = i.fieldType === 'checkbox' || i.fieldType === 'radio'
        ? `A ${i.fieldType} ${i.label ? 'called ' : ''}${label}, currently ${i.checked ? 'selected' : 'not selected'}.`
        : `${/^[aeiou]/i.test(i.fieldType || 'text') ? 'An' : 'A'} ${i.fieldType === 'textarea' ? 'multi-line' : i.fieldType || 'text'} field ${i.label ? 'called ' : ''}${label}.`;
      const bits = [];
      if (i.required) bits.push('It\u2019s required.');
      if (i.sensitive) bits.push(i.filled ? 'It already has something typed in, which I won\u2019t read out.' : 'It\u2019s empty.');
      else if (i.value) bits.push(`It currently says ${i.value}.`);
      else if (i.fieldType !== 'checkbox' && i.fieldType !== 'radio') bits.push('It\u2019s empty.');
      return [t, ...bits].join(' ');
    }
    case 'image':
      return i.alt || i.caption ? `An image described as \u201c${i.alt || i.caption}\u201d.` : 'An image with no description.';
    default: {
      const parts = [];
      if (i.title) parts.push(`This is the ${i.title} section.`);
      if (i.text) parts.push(`It says: ${i.text}`);
      const has = [];
      if (i.buttons?.length) has.push(`${plural(i.buttons.length, 'button')}: ${list(i.buttons)}`);
      if (i.links?.length) has.push(`${plural(i.links.length, 'link')}: ${list(i.links)}`);
      if (i.inputs?.length) has.push(`${plural(i.inputs.length, 'field')}: ${list(i.inputs)}`);
      if (i.images) has.push(plural(i.images, 'image'));
      if (has.length) parts.push(`It has ${list(has)}.`);
      return parts.join(' ') || 'There\u2019s nothing readable here.';
    }
  }
}
