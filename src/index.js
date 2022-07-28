/**
 * Import deps
 */
import notifier from "codex-notifier";

/**
 * Import functions
 */
import * as Dom from "./utils/dom";
import { SelectionUtils } from "./utils/selection";
import { Utils } from "./utils/utils";

/**
 * @typedef {object} SearchItemData
 * @property {string} href - link target
 * @property {string} name - link name
 * @property {string} description - link description
 */

const DICTIONARY = {
  searchASnippet: "Search a snippet",
  noSnippetAvailable: "There are no snippets available...",
  searchRequestError: "Cannot process search request because of",
  invalidServerData: "Server responded with invalid data",
  invalidSnippetName: "Incorrect snippet name",
};

/**
 * Timeout before search in ms after key pressed
 *
 * @type {number}
 */
const DEBOUNCE_TIMEOUT = 250;

/**
 * @typedef {string} NavDirection
 */
/**
 * Enum specifying keyboard navigation directions
 *
 * @enum {NavDirection}
 */
const NavDirection = {
  Next: "Next",
  Previous: "Previous",
};

/**
 * Link Autocomplete Tool for EditorJS
 */
export default class Snippets {
  /**
   * Specifies Tool as Inline Toolbar Tool
   *
   * @returns {boolean}
   */
  static get isInline() {
    return true;
  }

  /**
   * Sanitizer Rule
   * Leave <span class="className"> tags
   *
   * @returns {object}
   */
  static get sanitize() {
    return {
      span: {
        class: true,
        "data-name": true,
        "data-description": true,
      },
    };
  }

  /**
   * Title for hover-tooltip
   *
   * @returns {string}
   */
  static get title() {
    return "Snippets";
  }

  /**
   * Set a shortcut
   *
   * @returns {string}
   */
  get shortcut() {
    return "Ctrl+L";
  }

  /**
   * @private
   *
   * @returns {object<string, string>} — keys and class names
   */
  static get CSS() {
    return {
      iconWrapper: "ts-snippets__icon-wrapper",

      hidden: "ts-snippets__hidden",

      actionsWrapper: "ts-snippets__actions-wrapper",

      field: "ts-snippets__field",
      fieldLoading: "ts-snippets__field--loading",
      fieldInput: "ts-snippets__field-input",

      foundItems: "ts-snippets__items",

      searchItem: "ts-snippets__search-item",
      searchItemSelected: "ts-snippets__search-item--selected",
      searchItemName: "ts-snippets__search-item-name",
      searchItemDescription: "ts-snippets__search-item-description",

      linkDataWrapper: "ts-snippets__link-data-wrapper",
      linkDataTitleWrapper: "ts-snippets__link-data-title-wrapper",
      linkDataName: "ts-snippets__link-data-name",
      linkDataDescription: "ts-snippets__link-data-description",
      linkDataURL: "ts-snippets__link-data-url",
    };
  }

  /**
   * Initialize basic data
   *
   * @param {object} options - tools constructor params
   * @param {object} options.config — initial config for the tool
   * @param {object} options.api — methods from Core
   */
  constructor({ config, api }) {
    /**
     * Essential tools
     */
    this.api = api;
    this.config = config || {};
    this.selection = new SelectionUtils();

    /**
     * Config params
     */
    this.filesToSearch = this.config.filesToSearch || [];

    /**
     * Tool's nodes list
     *
     * toolButtons
     *   |- toolButtonLink
     *   |- toolButtonUnlink
     *
     * actionsWrapper
     *   |- inputWrapper
     *   |    |- inputField
     *   |    |- loader
     *   |
     *   |- searchResults
     *   |    |- searchItemWrapper
     *   |    |    |- searchItemName
     *   |    |    |- searchItemDescription
     *   |    |
     *   |    |- ...
     *   |
     *   |- linkDataWrapper
     *        |- URL
     *        |- name
     *        |- description
     */
    this.nodes = {
      toolButtons: null,
      toolButtonLink: null,
      toolButtonUnlink: null,

      actionsWrapper: null,
      inputWrapper: null,
      inputField: null,

      searchResults: null,

      linkDataWrapper: null,
      linkDataTitleWrapper: null,
      linkDataName: null,
      linkDataDescription: null,
      linkDataURL: null,
    };

    /**
     * Define tag name for a link element
     */
    this.tagName = "SPAN";

    /**
     * Key codes
     */
    this.KEYS = {
      ENTER: 13,
      UP: 38,
      DOWN: 40,
    };

    /**
     * Define debounce timer
     */
    this.typingTimer = null;
  }

  /**
   * Create element with buttons for toolbar
   *
   * @returns {HTMLDivElement}
   */
  render() {
    /**
     * Create wrapper for buttons
     *
     * @type {HTMLButtonElement}
     */
    this.nodes.toolButtons = Dom.make(
      "button",
      this.api.styles.inlineToolButton
    );

    /**
     * Create Link button
     *
     * @type {HTMLSpanElement}
     */
    this.nodes.toolButtonLink = Dom.make("span", Snippets.CSS.iconWrapper, {
      innerHTML: require("../icons/snippet-add.svg"),
    });
    this.nodes.toolButtons.appendChild(this.nodes.toolButtonLink);

    /**
     * Create Unlink button
     *
     * @type {HTMLSpanElement}
     */
    this.nodes.toolButtonUnlink = Dom.make("span", Snippets.CSS.iconWrapper, {
      innerHTML: require("../icons/snippet-remove.svg"),
    });
    this.nodes.toolButtons.appendChild(this.nodes.toolButtonUnlink);
    this.toggleVisibility(this.nodes.toolButtonUnlink, false);

    return this.nodes.toolButtons;
  }

  /**
   * Render actions element
   *
   * @returns {HTMLDivElement}
   */
  renderActions() {
    /**
     * Render actions wrapper
     *
     * @type {HTMLDivElement}
     */
    this.nodes.actionsWrapper = Dom.make("div", [Snippets.CSS.actionsWrapper]);
    this.toggleVisibility(this.nodes.actionsWrapper, false);

    /**
     * Render input field
     *
     * @type {HTMLDivElement}
     */
    this.nodes.inputWrapper = Dom.make("div", Snippets.CSS.field);
    this.nodes.inputField = Dom.make("input", Snippets.CSS.fieldInput, {
      placeholder: this.api.i18n.t(
        this.isThereFilesToSearch
          ? DICTIONARY.searchASnippet
          : DICTIONARY.noSnippetAvailable
      ),
    });

    this.nodes.inputWrapper.appendChild(this.nodes.inputField);
    this.toggleVisibility(this.nodes.inputWrapper, false);

    /**
     * Render search results
     *
     * @type {HTMLDivElement}
     */
    this.nodes.searchResults = Dom.make("div", Snippets.CSS.foundItems);
    /**
     * To improve UX we need to remove any 'selected' classes from search results
     */
    this.nodes.searchResults.addEventListener("mouseenter", () => {
      const searchItems = this.getSearchItems();

      searchItems.forEach((item) => {
        item.classList.remove(Snippets.CSS.searchItemSelected);
      });
    });
    /**
     * Enable search results click listener
     */
    this.nodes.searchResults.addEventListener("click", (event) => {
      const closestSearchItem = event.target.closest(
        `.${Snippets.CSS.searchItem}`
      );

      /**
       * If click target search item is missing then do nothing
       */
      if (!closestSearchItem) {
        return;
      }

      /**
       * Preventing events that will be able to happen
       */
      event.preventDefault();
      event.stopPropagation();

      this.searchItemPressed(closestSearchItem);
    });

    /**
     * Listen to pressed enter key or up and down arrows
     */
    this.nodes.inputField.addEventListener(
      "keydown",
      this.fieldKeydownHandler.bind(this)
    );

    /**
     * Listen to input
     */
    this.nodes.inputField.addEventListener(
      "input",
      this.fieldInputHandler.bind(this)
    );

    /**
     * Render link data block
     * TODO: CHange this block accordingly
     */
    this.nodes.linkDataWrapper = Dom.make("div", Snippets.CSS.linkDataWrapper);
    this.toggleVisibility(this.nodes.linkDataWrapper, false);

    this.nodes.linkDataTitleWrapper = Dom.make(
      "div",
      Snippets.CSS.linkDataTitleWrapper
    );
    this.nodes.linkDataWrapper.appendChild(this.nodes.linkDataTitleWrapper);
    this.toggleVisibility(this.nodes.linkDataTitleWrapper, false);

    this.nodes.linkDataName = Dom.make("div", Snippets.CSS.linkDataName);
    this.nodes.linkDataTitleWrapper.appendChild(this.nodes.linkDataName);
    this.nodes.linkDataDescription = Dom.make(
      "div",
      Snippets.CSS.linkDataDescription
    );
    this.nodes.linkDataTitleWrapper.appendChild(this.nodes.linkDataDescription);

    this.nodes.linkDataURL = Dom.make("A", Snippets.CSS.linkDataURL);
    this.nodes.linkDataWrapper.appendChild(this.nodes.linkDataURL);

    /**
     * Compose actions block
     */
    this.nodes.actionsWrapper.appendChild(this.nodes.inputWrapper);
    this.nodes.actionsWrapper.appendChild(this.nodes.searchResults);
    this.nodes.actionsWrapper.appendChild(this.nodes.linkDataWrapper);

    return this.nodes.actionsWrapper;
  }

  /**
   * Process keydown events to detect arrow keys or enter pressed
   *
   * @param {KeyboardEvent} event — keydown event
   * @returns {void}
   */
  fieldKeydownHandler(event) {
    const isArrowKey = [this.KEYS.UP, this.KEYS.DOWN].includes(event.keyCode);
    const isEnterKey = this.KEYS.ENTER === event.keyCode;

    /**
     * If key is not an arrow or enter
     */
    if (!isArrowKey && !isEnterKey) {
      return;
    }

    /**
     * Preventing events that will be able to happen
     */
    event.preventDefault();
    event.stopPropagation();

    /**
     * Choose handler
     */
    switch (true) {
      /**
       * Handle arrow keys
       */
      case isArrowKey: {
        const direction =
          event.keyCode === this.KEYS.DOWN
            ? NavDirection.Next
            : NavDirection.Previous;

        this.navigate(direction);
        break;
      }

      /**
       * Handle Enter key
       */
      case isEnterKey:
        this.processEnterKeyPressed();
        break;
    }
  }

  /**
   * Input event listener for a input field
   *
   * @param {KeyboardEvent} event — input event
   * @returns {void}
   */
  fieldInputHandler(event) {
    /**
     * Stop debounce timer
     */
    clearTimeout(this.typingTimer);

    /**
     * Get input value
     */
    const searchString = event.target.value;

    /**
     * If search string is empty then clear search list
     */
    if (!searchString || !searchString.trim()) {
      this.clearSearchList();

      return;
    }

    /**
     * If no server endpoint then do nothing
     */
    if (!this.isThereFilesToSearch) {
      return;
    }

    /**
     * Define a new timer
     */
    this.typingTimer = setTimeout(async () => {
      /**
       * Show the loader during request
       */
      this.toggleLoadingState(true);
      try {
        const searchDataItems = await this.searchRequest(searchString);

        /**
         * Generate list
         */
        this.generateSearchList(searchDataItems);
      } catch (e) {
        notifier.show({
          message: `${DICTIONARY.searchRequestError} "${e.message}"`,
          style: "error",
        });
      }

      this.toggleLoadingState(false);
    }, DEBOUNCE_TIMEOUT);
  }

  /**
   * Hides / shows loader
   *
   * @param {boolean} state - true to show
   * @returns {void}
   */
  toggleLoadingState(state) {
    this.nodes.inputWrapper.classList.toggle(Snippets.CSS.fieldLoading, state);
  }

  /**
   * Navigate found items
   *
   * @param {NavDirection} direction - next or previous
   * @returns {void}
   */
  navigate(direction) {
    /**
     * Getting search items
     */
    const items = this.getSearchItems();
    const selectedItem = this.getSelectedItem();

    if (!items.length) {
      return;
    }

    /**
     * Next: index + 1
     * Prev: index - 1
     */
    const indexDelta = direction === NavDirection.Next ? 1 : -1;
    const selectedItemIndex = selectedItem ? items.indexOf(selectedItem) : -1;
    let nextIndex = selectedItemIndex + indexDelta;

    if (nextIndex > items.length - 1) {
      nextIndex = 0;
    } else if (nextIndex < 0) {
      nextIndex = items.length - 1;
    }

    if (selectedItem) {
      selectedItem.classList.remove(Snippets.CSS.searchItemSelected);
    }

    items[nextIndex].classList.add(Snippets.CSS.searchItemSelected);
  }

  /**
   * Process enter key pressing
   *
   * @returns {void}
   */
  processEnterKeyPressed() {
    /**
     * Try to get selected item
     *
     * @type {Element|null}
     */
    const selectedItem = this.getSelectedItem();

    /**
     * If any item was manually selected then process click on it
     */
    if (selectedItem) {
      this.searchItemPressed(selectedItem);

      return;
    }

    /**
     * Get input field value
     */
    const index = this.nodes.inputField.value;

    /**
     * If input field is empty then do nothing
     */
    if (!index || !index.trim()) {
      return;
    }

    /**
     * Get the first item from the search list
     *
     * @type {Element}
     */
    const composedItem = this.getSearchItems()[0];

    /**
     * If input is not the first name on the list then show an error
     */

    if (!composedItem || composedItem.dataset.index !== index.toLowerCase()) {
      notifier.show({
        message: DICTIONARY.invalidSnippetName,
        style: "error",
      });
      return;
    }

    /**
     * "Press" search item
     */
    this.searchItemPressed(composedItem);
  }

  /**
   * Get search items
   *
   * @returns {Element[]}
   */
  getSearchItems() {
    const nodesList = this.nodes.searchResults.querySelectorAll(
      `.${Snippets.CSS.searchItem}`
    );

    return Array.from(nodesList);
  }

  /**
   * Find selected item
   *
   * @returns {Element|null}
   */
  getSelectedItem() {
    return this.nodes.searchResults.querySelector(
      `.${Snippets.CSS.searchItemSelected}`
    );
  }

  /**
   * Remove search result elements
   *
   * @returns {void}
   */
  clearSearchList() {
    this.nodes.searchResults.innerHTML = "";
  }

  /**
   * Fill up a search list results by data
   *
   * @param {SearchItemData[]} items — items to be shown
   * @returns {void}
   */
  generateSearchList(items = []) {
    /**
     * Clear list first
     */
    this.clearSearchList();

    /**
     * If items data is not an array
     */
    if (!Utils.isArray(items)) {
      notifier.show({
        message: DICTIONARY.invalidServerData,
        style: "error",
      });

      return;
    }

    /**
     * If no items returned
     */
    if (items.length === 0) {
      return;
    }

    /**
     * Fill up search list by new elements
     */
    items.forEach((item) => {
      const searchItem = Dom.make("div", [Snippets.CSS.searchItem]);

      /**
       * Create a name for a link
       */
      const searchItemName = Dom.make("div", [Snippets.CSS.searchItemName], {
        innerText: item.name || item.index,
      });

      searchItem.appendChild(searchItemName);

      /**
       * Create a description element
       */
      if (item.desc) {
        const searchItemDescription = Dom.make(
          "div",
          [Snippets.CSS.searchItemDescription],
          {
            innerText: item.desc[0],
          }
        );

        searchItem.appendChild(searchItemDescription);
      }

      /**
       * Save all keys to item's dataset
       */
      Object.keys(item).forEach((key) => {
        searchItem.dataset[key] = item[key];
      });

      this.nodes.searchResults.appendChild(searchItem);
    });
  }

  /**
   * Process 'press' event on the search item
   *
   * @param {Element} element - pressed item element
   * @returns {void}
   */
  searchItemPressed(element) {
    /**
     * If no useful dataset info was given then do nothing
     */
    if (!element.dataset || !element.dataset["index"]) {
      return;
    }

    /**
     * Restore origin selection
     */

    this.selection.restore();

    this.selection.removeFakeBackground();

    /**
     * Create a link by default browser's function
     */
    this.wrap(element.dataset);

    /**
     * Close toolbar
     */
    this.api.inlineToolbar.close();
  }

  wrap(dataset) {
    let sel, range, span, originalHtml;

    if (window.getSelection && (sel = window.getSelection()).rangeCount) {
      range = sel.getRangeAt(0);

      span = document.createElement(this.tagName);

      span.classList.add("ts-snippet");
      span.classList.add("ts-snippet-" + dataset["index"]);

      span.dataset["name"] = dataset["name"];
      span.dataset["description"] = dataset["desc"];

      originalHtml = range.extractContents();

      span.appendChild(originalHtml);

      range.insertNode(span);

      this.api.selection.expandToTag(span);
    }
  }

  /**
   * Handle clicks on the Inline Toolbar icon
   *
   * @param {Range} range — range to wrap with link
   * @returns {void}
   */
  surround(range) {
    if (!range) {
      return;
    }

    if (
      !!document.getElementsByClassName(
        "ce-link-autocomplete__actions-wrapper"
      )[0] &&
      !document
        .getElementsByClassName("ce-link-autocomplete__actions-wrapper")[0]
        .classList.contains("ce-link-autocomplete__hidden")
    ) {
      this.api.inlineToolbar.close();
      console.log("Link already opened");
    }
    /**
     * Show actions wrapper
     */
    this.toggleVisibility(this.nodes.actionsWrapper, true);

    /**
     * Get result state after checkState() function
     * If tool button icon unlink is active then selected text is a link
     *
     * @type {boolean}
     */
    const isSnippetSelected = this.nodes.toolButtonUnlink.classList.contains(
      this.api.styles.inlineToolButtonActive
    );

    /**
     * Create a fake selection
     */
    this.selection.setFakeBackground();
    this.selection.save();

    /**
     * Check if link is in the selection
     */
    if (!isSnippetSelected) {
      /**
       * Show focused input field
       */
      this.toggleVisibility(this.nodes.inputWrapper, true);
      this.nodes.inputField.focus();
    } else {
      /**
       * Get the nearest snippet tag
       */
      const termWrapper = this.api.selection.findParentTag(
        this.tagName,
        "ts-snippet"
      );

      /**
       * Remove the snippet
       */
      this.unwrap(termWrapper);

      /**
       * Remove fake selection and close toolbar
       */
      this.selection.restore;
      this.selection.removeFakeBackground();
      this.api.inlineToolbar.close();
    }
  }

  unwrap(termWrapper) {
    /**
     * Expand selection to all term-tag
     */
    this.api.selection.expandToTag(termWrapper);

    const sel = window.getSelection();
    const range = sel.getRangeAt(0);

    const unwrappedContent = range.extractContents();

    /**
     * Remove empty term-tag
     */
    termWrapper.parentNode.removeChild(termWrapper);

    /**
     * Insert extracted content
     */
    range.insertNode(unwrappedContent);

    /**
     * Restore selection
     */
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * Check for a tool's state
   *
   * @param {Selection} selection — selection to be passed from Core
   * @returns {void}
   */
  checkState(selection) {
    const text = selection.anchorNode;
    /**
     * Selection is empty
     */
    if (!text) {
      return;
    }

    /**
     * Find the nearest link tag
     */
    const parentA = this.selection.findParentTag(this.tagName);

    /**
     * If no link tag then do nothing
     */
    if (!parentA) {
      return;
    }

    this.toggleVisibility(this.nodes.actionsWrapper, true);

    /**
     * Fill up link data block
     */
    this.nodes.linkDataName.innerText = parentA.dataset.name || "";
    this.nodes.linkDataDescription.innerText =
      parentA.dataset.description || "";
    this.nodes.linkDataURL.innerText = parentA.href || "";
    this.nodes.linkDataURL.href = parentA.href || "";
    this.nodes.linkDataURL.target = "_blank";

    /**
     * If link has name or description then show title wrapper
     */
    if (parentA.dataset.name || parentA.dataset.description) {
      this.toggleVisibility(this.nodes.linkDataTitleWrapper, true);
    }

    /**
     * Show link data block
     */
    this.toggleVisibility(this.nodes.linkDataWrapper, true);

    /**
     * Show 'unlink' icon
     */
    this.toggleVisibility(this.nodes.toolButtonLink, false);
    this.toggleVisibility(this.nodes.toolButtonUnlink, true);
    this.nodes.toolButtonUnlink.classList.add(
      this.api.styles.inlineToolButtonActive
    );
  }

  /**
   * Show or hide target element
   *
   * @param {HTMLElement} element — target element
   * @param {boolean} isVisible — visibility state
   * @returns {void}
   */
  toggleVisibility(element, isVisible = true) {
    /**
     * If not "isVisible" then add "hidden" class
     */
    element.classList.toggle(Snippets.CSS.hidden, !isVisible);
  }

  /**
   * Send search request
   *
   * @param {string} searchString - search string input
   *
   * @returns {Promise<SearchItemData[]>}
   */
  async searchRequest(searchString) {
    try {
      //Open JSON
      const conditions = await require("../src/api/5e-SRD-Conditions.json");

      //Find matches that starts with searchString
      let matches = conditions.filter((condition) => {
        const regex = new RegExp(`^${searchString}`, "gi");
        return condition.index.match(regex) || condition.name.match(regex);
      });

      return matches;
    } catch (e) {
      notifier.show({
        message: `${DICTIONARY.searchRequestError} "${e.message}"`,
        style: "error",
      });
    }

    return [];
  }

  /**
   * Do we need to send requests to the server
   *
   * @returns {boolean}
   */
  isThereFilesToSearch() {
    return !!this.filesToSearch;
  }

  /**
   * Function called with Inline Toolbar closing
   *
   * @returns {void}
   */
  clear() {
    if (this.selection.isFakeBackgroundEnabled) {
      // if actions is broken by other selection We need to save new selection
      const currentSelection = new SelectionUtils();

      currentSelection.save();

      this.selection.restore();
      this.selection.removeFakeBackground();
      this.selection.clearSaved();

      // and recover new selection after removing fake background
      currentSelection.restore();
    }
  }
}
