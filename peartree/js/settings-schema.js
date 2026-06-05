export { DEFAULT_SETTINGS } from './config.js';

export const BUILT_IN_THEMES = ['Monochrome', 'ARTIC', 'BEAST', "O'Toole", 'MCM'];

export const URL_PARAMS = [
  { param: 'palette',     label: 'Settings panel button',  desc: 'Show/hide the Settings sidebar toggle' },
  { param: 'toolbar',     label: 'Toolbar',                desc: 'Show/hide the top toolbar' },
  { param: 'import',      label: 'Open / Import buttons',  desc: 'Show/hide Open Tree and Import Annotations buttons' },
  { param: 'export',      label: 'Export buttons',         desc: 'Show/hide Export Tree and Export Graphic buttons' },
  { param: 'rtt',         label: 'Root-to-tip button',     desc: 'Show/hide the RTT scatter-plot panel button' },
  { param: 'rttheader',   label: 'RTT panel header',       desc: 'Show/hide the Root-to-tip panel header bar' },
  { param: 'dt',          label: 'Data table button',      desc: 'Show/hide the Data Table panel button' },
  { param: 'dtheader',    label: 'Data table header',      desc: 'Show/hide the Data Table panel header rows' },
  { param: 'statusbar',   label: 'Status bar',             desc: 'Show/hide the bottom status bar' },
  { param: 'sbstats',     label: 'Status: tree stats',     desc: 'Show/hide the status bar tree statistics section' },
  { param: 'sbselect',    label: 'Status: selection count',desc: 'Show/hide the status bar selection count section' },
  { param: 'sbmessage',   label: 'Status: transient message', desc: 'Show/hide the status bar transient message section' },
  { param: 'sbshare',     label: 'Status: share-link button', desc: 'Show/hide the status bar share-link button' },
  { param: 'help',        label: 'Help button',            desc: 'Show/hide the ? Help button' },
  { param: 'about',       label: 'About button',           desc: 'Show/hide the About button' },
  { param: 'themetoggle', label: 'Theme toggle button',    desc: 'Show/hide the light/dark theme toggle button' },
  { param: 'brand',       label: 'PearTree brand logo',    desc: 'Show/hide the PearTree brand name/logo in the toolbar' },
  { param: 'tbfileops',   label: 'Toolbar: File ops',      desc: 'Show/hide Open, Import, Export buttons' },
  { param: 'tbann',       label: 'Toolbar: Annotations',   desc: 'Show/hide annotation utility buttons' },
  { param: 'tbnode',      label: 'Toolbar: Node info',     desc: 'Show/hide Node Info button' },
  { param: 'tbnav',       label: 'Toolbar: Navigation',    desc: 'Show/hide back/forward/drill/climb/home groups' },
  { param: 'tbzoom',      label: 'Toolbar: Zoom',          desc: 'Show/hide zoom and fit groups' },
  { param: 'tborder',     label: 'Toolbar: Order',         desc: 'Show/hide branch ordering group' },
  { param: 'tbrotate',    label: 'Toolbar: Rotate',        desc: 'Show/hide rotate node/subtree group' },
  { param: 'tbreroot',    label: 'Toolbar: Reroot',        desc: 'Show/hide invert-selection and reroot controls' },
  { param: 'tbhide',      label: 'Toolbar: Hide/Show',     desc: 'Show/hide collapse/expand subtree and clade groups' },
  { param: 'tbcolour',    label: 'Toolbar: Colour',        desc: 'Show/hide colour picker and clade highlight controls' },
  { param: 'tbfilter',    label: 'Toolbar: Filter',        desc: 'Show/hide tip filter box' },
  { param: 'tbpanels',    label: 'Toolbar: Panels',        desc: 'Show/hide Data Table and RTT panel buttons' },
  { param: 'keyboard',    label: 'Keyboard shortcuts',     desc: 'Enable/disable keyboard shortcuts' },
];

export const SETTINGS_SCHEMA = [
  {
    key: 'introAnimation',
    label: 'Intro animation',
    group: 'Tree',
    type: 'select',
    options: [
      { value: 'x-then-y',    label: 'X then Y (default)' },
      { value: 'y-then-x',    label: 'Y then X' },
      { value: 'simultaneous',label: 'Simultaneous' },
      { value: 'from-bottom', label: 'From bottom' },
      { value: 'from-top',    label: 'From top' },
      { value: 'none',        label: 'None' },
    ],
    desc: 'Opening animation style when a tree loads.',
  },
  {
    key: 'tipLabelShow',
    label: 'Tip labels',
    group: 'Tip labels',
    type: 'select',
    options: [
      { value: 'off',   label: 'Off' },
      { value: 'name',  label: 'Name (default)' },
    ],
    desc: 'Which annotation to show as tip labels.',
  },
  {
    key: 'axisShow',
    label: 'Axis',
    group: 'Axis',
    type: 'select',
    options: [
      { value: 'off',     label: 'Off' },
      { value: 'forward', label: 'Forward / divergence (default)' },
      { value: 'reverse', label: 'Reverse (from tips)' },
      { value: 'time',    label: 'Time (requires date annotation)' },
    ],
    desc: 'Axis display mode.',
  },
  {
    key: 'selectedTheme',
    label: 'Theme',
    group: 'Theme',
    type: 'select',
    get options() {
      return BUILT_IN_THEMES.map(name => ({ value: name, label: name }));
    },
    desc: 'Visual colour theme.',
  },
  {
    key: 'dataTableOpen',
    label: 'Data table open at startup',
    group: 'Panels',
    type: 'boolean',
    desc: 'Open the Data Table panel automatically on load.',
  },
  {
    key: 'rttOpen',
    label: 'Root-to-tip open at startup',
    group: 'Panels',
    type: 'boolean',
    desc: 'Open the Root-to-Tip panel automatically on load.',
  },
];
