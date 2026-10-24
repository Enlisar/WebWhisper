// Local, instant, private description of what is under the pointer.
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function composeLocal(i) {
  if (!i) return 'There’s nothing readable here.';

  switch (i.kind) {
    case 'button': {
      const label = i.label ? `“${i.label}”` : 'with no label';
      const parts = [`Button ${i.label ? '' : 'with no label'}${i.label ? label : ''}.`];

      // What it does or current state
      if (i.disabled) {
        parts.push('It is currently disabled.');
      } else if (i.isSummary) {
        parts.push(i.expanded ? 'Accordion section is open. Click to collapse.' : 'Accordion section is closed. Click to expand.');
      } else if (i.expanded !== null && i.expanded !== undefined) {
        parts.push(i.expanded ? 'Currently expanded. Click to collapse.' : 'Currently collapsed. Click to expand.');
      } else if (i.pressed !== null && i.pressed !== undefined) {
        parts.push(i.pressed ? 'Toggle button, currently turned on. Click to turn off.' : 'Toggle button, currently turned off. Click to turn on.');
      } else if (i.hasPopup === 'menu') {
        parts.push('Opens a dropdown menu.');
      } else if (i.hasPopup === 'dialog' || i.hasPopup === 'true') {
        parts.push('Opens a dialog window.');
      } else if (i.hasPopup === 'listbox') {
        parts.push('Opens a list of options.');
      } else if (i.buttonType === 'submit') {
        parts.push(i.formInfo ? `Submits the ${i.formInfo} form.` : 'Submits the form.');
      } else if (i.buttonType === 'reset') {
        parts.push('Resets all form fields.');
      } else if (i.actionText) {
        parts.push(i.actionText);
      } else if (i.description) {
        parts.push(i.description);
      }

      if (i.inSection && !parts.some((p) => p.includes('in the'))) {
        parts.push(`In the ${i.inSection} area.`);
      }

      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    case 'link': {
      const label = i.label ? `“${i.label}”` : '';
      const parts = [`Link ${label ? label : (i.humanDest ? 'to ' + i.humanDest : 'with no label')}.`];

      // Where it leads or what it does
      if (i.destType === 'action') {
        parts.push('Performs an action on this page.');
      } else if (i.destType === 'anchor') {
        parts.push(i.anchorName ? `Jumps to the ${i.anchorName} section on this page.` : 'Jumps to another section on this page.');
      } else if (i.destType === 'email') {
        parts.push(`Opens email to ${i.email}.`);
      } else if (i.destType === 'phone') {
        parts.push(`Calls phone number ${i.phone}.`);
      } else if (i.destType === 'download') {
        parts.push(i.fileName ? `Downloads ${i.fileName}.` : 'Downloads a file.');
      } else if (i.humanDest) {
        parts.push(`Leads to ${i.humanDest}.`);
      } else if (i.destType === 'external') {
        const dest = i.hostname ? `external website ${i.hostname}${i.pathname ? ' ' + i.pathname.replace(/\//g, ' slash ') : ''}` : 'an external website';
        parts.push(`Leads to ${dest}.`);
      } else if (i.destType === 'internal') {
        const cleanPath = (i.pathname || '').replace(/^\//, '').replace(/[_-]+/g, ' ');
        const dest = cleanPath ? `${cleanPath} on this site` : 'this site’s home page';
        parts.push(`Leads to ${dest}.`);
      } else if (i.href) {
        parts.push(`Leads to ${i.href.replace(/\//g, ' slash ')}.`);
      }

      if (i.targetBlank) {
        parts.push('Opens in a new tab.');
      }

      if (i.description) {
        parts.push(i.description);
      }

      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    case 'input': {
      const label = i.label ? `“${i.label}”` : 'with no label';
      const isCheckOrRadio = i.fieldType === 'checkbox' || i.fieldType === 'radio';

      let typeDesc = 'Text box';
      if (i.isSearch) typeDesc = 'Search box';
      else if (i.fieldType === 'textarea') typeDesc = 'Multi-line text box';
      else if (i.fieldType === 'contenteditable') typeDesc = 'Editable text area';
      else if (i.fieldType === 'password') typeDesc = 'Password field';
      else if (i.fieldType === 'email') typeDesc = 'Email text box';
      else if (i.fieldType === 'number') typeDesc = 'Number field';
      else if (i.fieldType === 'tel') typeDesc = 'Phone number field';
      else if (i.fieldType === 'url') typeDesc = 'Web address field';
      else if (i.fieldType === 'checkbox') typeDesc = 'Checkbox';
      else if (i.fieldType === 'radio') typeDesc = 'Radio button';
      else if (i.fieldType === 'select') typeDesc = 'Dropdown menu';
      else if (i.fieldType === 'file') typeDesc = 'File upload field';

      const parts = [`${typeDesc} ${i.label ? 'for ' + label : label}.`];

      // What it says / current content
      if (isCheckOrRadio) {
        parts.push(i.checked ? 'Currently checked.' : 'Currently not checked.');
        parts.push('Click to toggle.');
      } else if (i.fieldType === 'select') {
        if (i.selectedText) parts.push(`Currently selected: “${i.selectedText}”.`);
        if (i.optionsCount) parts.push(`Has ${i.optionsCount} options.`);
        parts.push('Click to choose an option.');
      } else if (i.sensitive) {
        parts.push(i.filled ? 'It already has something typed in, which I won’t read out.' : 'It is empty.');
      } else if (i.value) {
        parts.push(`It currently says: “${i.value}”.`);
      } else {
        parts.push('It is empty.');
        if (i.placeholder) {
          parts.push(`Placeholder says: “${i.placeholder}”.`);
        }
      }

      if (i.required) parts.push('Required.');
      if (i.disabled) parts.push('Disabled.');
      if (i.readonly) parts.push('Read-only.');
      if (i.description) parts.push(i.description);

      // What it does
      if (i.actionText) {
        parts.push(i.actionText);
      } else if (i.isSearch && !isCheckOrRadio) {
        parts.push('Type keywords to search.');
      }

      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    case 'heading': {
      return `Heading level ${i.level || 2}: “${i.text}”.`;
    }

    case 'text': {
      const tagPrefix = {
        blockquote: 'Quote',
        li: 'List item',
        figcaption: 'Caption',
        caption: 'Table caption',
        th: 'Table header',
        td: 'Table cell',
        pre: 'Code block',
        code: 'Code snippet',
      }[i.tag] || '';

      if (tagPrefix) {
        return `${tagPrefix}: “${i.text}”.`;
      }
      return `${i.text}`;
    }

    case 'image': {
      if (i.alt) return `Image described as: “${i.alt}”.`;
      if (i.caption) return `Image with caption: “${i.caption}”.`;
      return 'An image with no description.';
    }

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
      return parts.join(' ') || 'There’s nothing readable here.';
    }
  }
}
