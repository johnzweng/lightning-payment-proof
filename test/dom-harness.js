// Minimal DOM contract double, not an HTML parser/browser. This makes accidental use of
// innerHTML on any non-icon element a test failure, and lets us inspect rendered/copy text.
export class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.open = false;
  }
  append(...children) { this.children.push(...children.map((c) => c instanceof Element ? c : String(c))); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() {}
  get textContent() { return this.children.map((c) => c instanceof Element ? c.textContent : c).join(''); }
  set textContent(text) { this.children = [String(text)]; }
  set innerHTML(markup) {
    if (this.tagName !== 'template' || !markup.startsWith('<svg viewBox="0 0 24 24"') || !markup.endsWith('</svg>')) {
      throw new Error('Unexpected HTML parsing: use text nodes');
    }
    this.content = { firstElementChild: new Element('svg') };
  }
}
export const document = { createElement: (tag) => new Element(tag), body: new Element('body') };
export function descendants(element, predicate = () => true) {
  return [element, ...element.children.filter((c) => c instanceof Element).flatMap((c) => descendants(c))].filter(predicate);
}
