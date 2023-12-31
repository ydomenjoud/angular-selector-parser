/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const _SELECTOR_REGEXP = new RegExp('(\\:not\\()|' + // 1: ":not("
  '(([\\.\\#]?)[-\\w]+)|' + // 2: "tag"; 3: "."/"#";
  // "-" should appear first in the regexp below as FF31 parses "[.-\w]" as a range
  // 4: attribute; 5: attribute_string; 6: attribute_value
  '(?:\\[([-.\\w*\\\\$]+)(?:=([\"\']?)([^\\]\"\']*)\\5)?\\])|' + // "[name]", "[name=value]",
  // "[name="value"]",
  // "[name='value']"
  '(\\))|' + // 7: ")"
  '(\\s*,\\s*)', // 8: ","
  'g');

/**
 * A css selector contains an element name,
 * css classes and attribute/value pairs with the purpose
 * of selecting subsets out of them.
 */
class CssSelector {
  constructor() {
    this.element = null;
    this.classNames = [];
    /**
     * The selectors are encoded in pairs where:
     * - even locations are attribute names
     * - odd locations are attribute values.
     *
     * Example:
     * Selector: `[key1=value1][key2]` would parse to:
     * ```
     * ['key1', 'value1', 'key2', '']
     * ```
     */
    this.attrs = [];
    this.notSelectors = [];
  }

  static parse(selector) {
    const results = [];
    const _addResult = (res, cssSel) => {
      if (cssSel.notSelectors.length > 0 && !cssSel.element && cssSel.classNames.length == 0 &&
        cssSel.attrs.length == 0) {
        cssSel.element = '*';
      }
      res.push(cssSel);
    };
    let cssSelector = new CssSelector();
    let match;
    let current = cssSelector;
    let inNot = false;
    _SELECTOR_REGEXP.lastIndex = 0;
    while (match = _SELECTOR_REGEXP.exec(selector)) {
      if (match[1 /* SelectorRegexp.NOT */]) {
        if (inNot) {
          throw new Error('Nesting :not in a selector is not allowed');
        }
        inNot = true;
        current = new CssSelector();
        cssSelector.notSelectors.push(current);
      }
      const tag = match[2 /* SelectorRegexp.TAG */];
      if (tag) {
        const prefix = match[3 /* SelectorRegexp.PREFIX */];
        if (prefix === '#') {
          // #hash
          current.addAttribute('id', tag.slice(1));
        } else if (prefix === '.') {
          // Class
          current.addClassName(tag.slice(1));
        } else {
          // Element
          current.setElement(tag);
        }
      }
      const attribute = match[4 /* SelectorRegexp.ATTRIBUTE */];
      if (attribute) {
        current.addAttribute(current.unescapeAttribute(attribute), match[6 /* SelectorRegexp.ATTRIBUTE_VALUE */]);
      }
      if (match[7 /* SelectorRegexp.NOT_END */]) {
        inNot = false;
        current = cssSelector;
      }
      if (match[8 /* SelectorRegexp.SEPARATOR */]) {
        if (inNot) {
          throw new Error('Multiple selectors in :not are not supported');
        }
        _addResult(results, cssSelector);
        cssSelector = current = new CssSelector();
      }
    }
    _addResult(results, cssSelector);
    return results;
  }

  /**
   * Unescape `\$` sequences from the CSS attribute selector.
   *
   * This is needed because `$` can have a special meaning in CSS selectors,
   * but we might want to match an attribute that contains `$`.
   * [MDN web link for more
   * info](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors).
   * @param attr the attribute to unescape.
   * @returns the unescaped string.
   */
  unescapeAttribute(attr) {
    let result = '';
    let escaping = false;
    for (let i = 0; i < attr.length; i++) {
      const char = attr.charAt(i);
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '$' && !escaping) {
        throw new Error(`Error in attribute selector "${attr}". ` +
          `Unescaped "$" is not supported. Please escape with "\\$".`);
      }
      escaping = false;
      result += char;
    }
    return result;
  }

  /**
   * Escape `$` sequences from the CSS attribute selector.
   *
   * This is needed because `$` can have a special meaning in CSS selectors,
   * with this method we are escaping `$` with `\$'.
   * [MDN web link for more
   * info](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors).
   * @param attr the attribute to escape.
   * @returns the escaped string.
   */
  escapeAttribute(attr) {
    return attr.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
  }

  isElementSelector() {
    return this.hasElementSelector() && this.classNames.length == 0 && this.attrs.length == 0 &&
      this.notSelectors.length === 0;
  }

  hasElementSelector() {
    return !!this.element;
  }

  setElement(element = null) {
    this.element = element;
  }

  getAttrs() {
    const result = [];
    if (this.classNames.length > 0) {
      result.push('class', this.classNames.join(' '));
    }
    return result.concat(this.attrs);
  }

  addAttribute(name, value = '') {
    this.attrs.push(name, value && value.toLowerCase() || '');
  }

  addClassName(name) {
    this.classNames.push(name.toLowerCase());
  }

  toString() {
    let res = this.element || '';
    if (this.classNames) {
      this.classNames.forEach(klass => res += `.${klass}`);
    }
    if (this.attrs) {
      for (let i = 0; i < this.attrs.length; i += 2) {
        const name = this.escapeAttribute(this.attrs[i]);
        const value = this.attrs[i + 1];
        res += `[${name}${value ? '=' + value : ''}]`;
      }
    }
    this.notSelectors.forEach(notSelector => res += `:not(${notSelector})`);
    return res;
  }
}

/**
 * Reads a list of CssSelectors and allows to calculate which ones
 * are contained in a given CssSelector.
 */
class SelectorMatcher {
  constructor() {
    this._elementMap = new Map();
    this._elementPartialMap = new Map();
    this._classMap = new Map();
    this._classPartialMap = new Map();
    this._attrValueMap = new Map();
    this._attrValuePartialMap = new Map();
    this._listContexts = [];
  }

  static createNotMatcher(notSelectors) {
    const notMatcher = new SelectorMatcher();
    notMatcher.addSelectables(notSelectors, null);
    return notMatcher;
  }

  addSelectables(cssSelectors, callbackCtxt) {
    let listContext = null;
    if (cssSelectors.length > 1) {
      listContext = new SelectorListContext(cssSelectors);
      this._listContexts.push(listContext);
    }
    for (let i = 0; i < cssSelectors.length; i++) {
      this._addSelectable(cssSelectors[i], callbackCtxt, listContext);
    }
  }

  /**
   * Add an object that can be found later on by calling `match`.
   * @param cssSelector A css selector
   * @param callbackCtxt An opaque object that will be given to the callback of the `match` function
   */
  _addSelectable(cssSelector, callbackCtxt, listContext) {
    let matcher = this;
    const element = cssSelector.element;
    const classNames = cssSelector.classNames;
    const attrs = cssSelector.attrs;
    const selectable = new SelectorContext(cssSelector, callbackCtxt, listContext);
    if (element) {
      const isTerminal = attrs.length === 0 && classNames.length === 0;
      if (isTerminal) {
        this._addTerminal(matcher._elementMap, element, selectable);
      } else {
        matcher = this._addPartial(matcher._elementPartialMap, element);
      }
    }
    if (classNames) {
      for (let i = 0; i < classNames.length; i++) {
        const isTerminal = attrs.length === 0 && i === classNames.length - 1;
        const className = classNames[i];
        if (isTerminal) {
          this._addTerminal(matcher._classMap, className, selectable);
        } else {
          matcher = this._addPartial(matcher._classPartialMap, className);
        }
      }
    }
    if (attrs) {
      for (let i = 0; i < attrs.length; i += 2) {
        const isTerminal = i === attrs.length - 2;
        const name = attrs[i];
        const value = attrs[i + 1];
        if (isTerminal) {
          const terminalMap = matcher._attrValueMap;
          let terminalValuesMap = terminalMap.get(name);
          if (!terminalValuesMap) {
            terminalValuesMap = new Map();
            terminalMap.set(name, terminalValuesMap);
          }
          this._addTerminal(terminalValuesMap, value, selectable);
        } else {
          const partialMap = matcher._attrValuePartialMap;
          let partialValuesMap = partialMap.get(name);
          if (!partialValuesMap) {
            partialValuesMap = new Map();
            partialMap.set(name, partialValuesMap);
          }
          matcher = this._addPartial(partialValuesMap, value);
        }
      }
    }
  }

  _addTerminal(map, name, selectable) {
    let terminalList = map.get(name);
    if (!terminalList) {
      terminalList = [];
      map.set(name, terminalList);
    }
    terminalList.push(selectable);
  }

  _addPartial(map, name) {
    let matcher = map.get(name);
    if (!matcher) {
      matcher = new SelectorMatcher();
      map.set(name, matcher);
    }
    return matcher;
  }

  /**
   * Find the objects that have been added via `addSelectable`
   * whose css selector is contained in the given css selector.
   * @param cssSelector A css selector
   * @param matchedCallback This callback will be called with the object handed into `addSelectable`
   * @return boolean true if a match was found
   */
  match(cssSelector, matchedCallback) {
    let result = false;
    const element = cssSelector.element;
    const classNames = cssSelector.classNames;
    const attrs = cssSelector.attrs;
    for (let i = 0; i < this._listContexts.length; i++) {
      this._listContexts[i].alreadyMatched = false;
    }
    result = this._matchTerminal(this._elementMap, element, cssSelector, matchedCallback) || result;
    result = this._matchPartial(this._elementPartialMap, element, cssSelector, matchedCallback) ||
      result;
    if (classNames) {
      for (let i = 0; i < classNames.length; i++) {
        const className = classNames[i];
        result =
          this._matchTerminal(this._classMap, className, cssSelector, matchedCallback) || result;
        result =
          this._matchPartial(this._classPartialMap, className, cssSelector, matchedCallback) ||
          result;
      }
    }
    if (attrs) {
      for (let i = 0; i < attrs.length; i += 2) {
        const name = attrs[i];
        const value = attrs[i + 1];
        const terminalValuesMap = this._attrValueMap.get(name);
        if (value) {
          result =
            this._matchTerminal(terminalValuesMap, '', cssSelector, matchedCallback) || result;
        }
        result =
          this._matchTerminal(terminalValuesMap, value, cssSelector, matchedCallback) || result;
        const partialValuesMap = this._attrValuePartialMap.get(name);
        if (value) {
          result = this._matchPartial(partialValuesMap, '', cssSelector, matchedCallback) || result;
        }
        result =
          this._matchPartial(partialValuesMap, value, cssSelector, matchedCallback) || result;
      }
    }
    return result;
  }

  /** @internal */
  _matchTerminal(map, name, cssSelector, matchedCallback) {
    if (!map || typeof name !== 'string') {
      return false;
    }
    let selectables = map.get(name) || [];
    const starSelectables = map.get('*');
    if (starSelectables) {
      selectables = selectables.concat(starSelectables);
    }
    if (selectables.length === 0) {
      return false;
    }
    let selectable;
    let result = false;
    for (let i = 0; i < selectables.length; i++) {
      selectable = selectables[i];
      result = selectable.finalize(cssSelector, matchedCallback) || result;
    }
    return result;
  }

  /** @internal */
  _matchPartial(map, name, cssSelector, matchedCallback) {
    if (!map || typeof name !== 'string') {
      return false;
    }
    const nestedSelector = map.get(name);
    if (!nestedSelector) {
      return false;
    }
    // TODO(perf): get rid of recursion and measure again
    // TODO(perf): don't pass the whole selector into the recursion,
    // but only the not processed parts
    return nestedSelector.match(cssSelector, matchedCallback);
  }
}

class SelectorListContext {
  constructor(selectors) {
    this.selectors = selectors;
    this.alreadyMatched = false;
  }
}

// Store context to pass back selector and context when a selector is matched
class SelectorContext {
  constructor(selector, cbContext, listContext) {
    this.selector = selector;
    this.cbContext = cbContext;
    this.listContext = listContext;
    this.notSelectors = selector.notSelectors;
  }

  finalize(cssSelector, callback) {
    let result = true;
    if (this.notSelectors.length > 0 && (!this.listContext || !this.listContext.alreadyMatched)) {
      const notMatcher = SelectorMatcher.createNotMatcher(this.notSelectors);
      result = !notMatcher.match(cssSelector, null);
    }
    if (result && callback && (!this.listContext || !this.listContext.alreadyMatched)) {
      if (this.listContext) {
        this.listContext.alreadyMatched = true;
      }
      callback(this.selector, this.cbContext);
    }
    return result;
  }
}

const selectorsQueryParamName = 'selectors';

document.addEventListener('DOMContentLoaded', () => {
  const origin = document.getElementById('origin');
  const parsed = document.getElementById('parsed');
  const share = document.getElementById('share');

  // get selectors in query
  const url = new URL(window.location);
  const querySelectors = url.searchParams.get(selectorsQueryParamName);
  if (querySelectors) {
    try {
      const data = JSON.parse(atob(querySelectors));
      if (data.join) {
        origin.value = data.join('\n');
      }
    } catch (e) {
      console.log(e);
    }
  }

  const parseContent = () => {
    const selectorsList = origin.value.split('\n');
    parsed.value = selectorsList
      .map(s => s.replace(/^ +/g, ''))
      .map(CssSelector.parse)
      .join('\n');

    // update share link
    const shareURL = new URL(window.location);
    shareURL.searchParams.set(
      selectorsQueryParamName,
      btoa(JSON.stringify(selectorsList))
    );
    share.href = shareURL.href;
  };

  // first pass
  parseContent();

  origin.addEventListener('keyup', e => parseContent());

});
