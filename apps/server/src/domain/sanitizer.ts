/*
The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/CPAL-1.0.
*/
import sanitizeHtml from 'sanitize-html';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'title'],
    '*': ['class']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      return {
        tagName,
        attribs: {
          ...attribs,
          href,
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      };
    }
  }
};

/**
 * Bereinigt HTML serverseitig nach dem Zero-Trust-Prinzip (dem Client wird niemals vertraut).
 * Entfernt Skripte, Event-Handler (onclick, onerror etc.), data:-URIs und gefährliche Tags.
 */
export function sanitizeServerHtml(dirtyHtml: string | null | undefined): string {
  if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';
  return sanitizeHtml(dirtyHtml, SANITIZE_OPTIONS).trim();
}
