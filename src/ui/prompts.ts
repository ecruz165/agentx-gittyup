/**
 * Custom select and checkbox prompts with Escape/left-arrow back navigation.
 * Built on @inquirer/core to intercept keyboard events that stock prompts don't support.
 */
import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  usePagination,
  useMemo,
  useRef,
  makeTheme,
  isEnterKey,
  isUpKey,
  isDownKey,
  isSpaceKey,
  isNumberKey,
  isBackspaceKey,
  Separator,
  ValidationError,
  type Status,
} from '@inquirer/core';
import { cursorHide } from '@inquirer/ansi';
import { styleText } from 'node:util';
import figures from '@inquirer/figures';

/** Sentinel value returned when user presses Escape or left-arrow to go back */
export const BACK = Symbol('BACK');
export type BackSymbol = typeof BACK;

// ─── Shared helpers ───

function isSelectable<T>(item: T | Separator): item is T & { disabled?: boolean | string } {
  return !Separator.isSeparator(item) && !(item as any).disabled;
}

function isBackKey(key: { name: string; ctrl: boolean }): boolean {
  return key.name === 'escape' || (key.name === 'left' && !key.ctrl);
}

// ─── Select with back ───

type SelectChoice<V> = { name?: string; value: V; short?: string; disabled?: boolean | string; description?: string } | Separator;

interface SelectConfig<V> {
  message: string;
  choices: ReadonlyArray<SelectChoice<V> | V>;
  default?: V;
  pageSize?: number;
  loop?: boolean;
  theme?: any;
}

const defaultSelectTheme = {
  icon: { cursor: figures.pointer },
  style: {
    disabled: (text: string) => styleText('dim', `- ${text}`),
    description: (text: string) => styleText('cyan', text),
    keysHelpTip: (keys: [string, string][]) =>
      keys.map(([key, action]) => `${styleText('bold', key)} ${styleText('dim', action)}`).join(styleText('dim', ' • ')),
  },
  indexMode: 'hidden' as const,
  keybindings: [] as string[],
};

function normalizeSelectChoices<V>(choices: ReadonlyArray<SelectChoice<V> | V>) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice)) return choice;
    if (typeof choice !== 'object' || choice === null || !('value' in choice)) {
      const name = String(choice);
      return { value: choice as V, name, short: name, disabled: false as const };
    }
    const name = choice.name ?? String(choice.value);
    const norm: any = { value: choice.value, name, short: choice.short ?? name, disabled: choice.disabled ?? false };
    if (choice.description) norm.description = choice.description;
    return norm;
  });
}

/**
 * A select prompt that returns BACK when user presses Escape or left-arrow.
 */
export const selectWithBack = createPrompt<any, SelectConfig<any>>((config, done) => {
  const { loop = true, pageSize = 7 } = config;
  const theme = makeTheme(defaultSelectTheme, config.theme);
  const [status, setStatus] = useState<Status>('idle');
  const [isBack, setIsBack] = useState(false);
  const prefix = usePrefix({ status, theme });
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const items = useMemo(() => normalizeSelectChoices(config.choices), [config.choices]);
  const bounds = useMemo(() => {
    const first = items.findIndex(isSelectable);
    const last = items.findLastIndex(isSelectable);
    if (first === -1) throw new ValidationError('[select prompt] No selectable choices.');
    return { first, last };
  }, [items]);

  const defaultIdx = useMemo(() => {
    if (!('default' in config)) return -1;
    return items.findIndex((item) => isSelectable(item) && (item as any).value === config.default);
  }, [config.default, items]);

  const [active, setActive] = useState(defaultIdx === -1 ? bounds.first : defaultIdx);
  const selectedChoice = items[active] as any;

  useKeypress((key, rl) => {
    clearTimeout(searchTimeoutRef.current);

    if (isBackKey(key)) {
      setIsBack(true);
      setStatus('done');
      done(BACK as any);
    } else if (isEnterKey(key)) {
      setStatus('done');
      done(selectedChoice.value);
    } else if (isUpKey(key, []) || isDownKey(key, [])) {
      rl.clearLine(0);
      if (loop || (isUpKey(key, []) && active !== bounds.first) || (isDownKey(key, []) && active !== bounds.last)) {
        const offset = isUpKey(key, []) ? -1 : 1;
        let next = active;
        do { next = (next + offset + items.length) % items.length; } while (!isSelectable(items[next]));
        setActive(next);
      }
    } else if (isNumberKey(key) && !Number.isNaN(Number(rl.line))) {
      const selectedIndex = Number(rl.line) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item) => {
        if (Separator.isSeparator(item)) return false;
        selectableIndex++;
        return selectableIndex === selectedIndex;
      });
      if (items[position] && isSelectable(items[position])) setActive(position);
      searchTimeoutRef.current = setTimeout(() => rl.clearLine(0), 700);
    } else if (isBackspaceKey(key)) {
      rl.clearLine(0);
    } else {
      // Search by typing
      const searchTerm = rl.line.toLowerCase();
      const matchIndex = items.findIndex((item) =>
        !Separator.isSeparator(item) && isSelectable(item) && (item as any).name.toLowerCase().startsWith(searchTerm),
      );
      if (matchIndex >= 0) setActive(matchIndex);
      searchTimeoutRef.current = setTimeout(() => rl.clearLine(0), 700);
    }
  });

  const message = theme.style.message(config.message, status);
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }: { item: any; isActive: boolean }) {
      if (Separator.isSeparator(item)) return ` ${item.separator}`;
      if (item.disabled) {
        const label = typeof item.disabled === 'string' ? item.disabled : '(disabled)';
        return theme.style.disabled(`${item.name} ${label}`);
      }
      const cursor = isActive ? theme.icon.cursor : ' ';
      const color = isActive ? theme.style.highlight : (x: string) => x;
      return color(`${cursor} ${item.name}`);
    },
    pageSize,
    loop,
  });

  if (status === 'done') {
    if (isBack) return '';
    const answer = theme.style.answer(selectedChoice.short ?? selectedChoice.name);
    return `${prefix} ${message} ${answer}`;
  }

  let description: string | undefined;
  if (selectedChoice.description) description = theme.style.description(selectedChoice.description);

  const keys: [string, string][] = [['↑↓', 'navigate'], ['⏎', 'submit'], ['esc/←', 'back']];
  const helpLine = theme.style.keysHelpTip(keys);

  return [`${prefix} ${message}`, page, description ?? '', helpLine].filter(Boolean).join('\n').trimEnd() + cursorHide;
});

// ─── Checkbox with back ───

type CheckboxChoice<V> = {
  name?: string;
  value: V;
  short?: string;
  checkedName?: string;
  disabled?: boolean | string;
  checked?: boolean;
  description?: string;
  /** Optional group identifier — used by the folder-toggle shortcut to toggle all items in the same group. */
  group?: string;
} | Separator;

interface CheckboxConfig<V> {
  message: string;
  choices: ReadonlyArray<CheckboxChoice<V>>;
  pageSize?: number;
  loop?: boolean;
  required?: boolean;
  validate?: (items: ReadonlyArray<{ value: V }>) => boolean | string | Promise<boolean | string>;
  shortcuts?: { all?: string; invert?: string; folder?: string };
  theme?: any;
}

const defaultCheckboxTheme = {
  icon: {
    checked: styleText('green', figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
  },
  style: {
    disabledChoice: (text: string) => styleText('dim', `- ${text}`),
    renderSelectedChoices: (selectedChoices: any[]) => selectedChoices.map((c: any) => c.short).join(', '),
    description: (text: string) => styleText('cyan', text),
    keysHelpTip: (keys: [string, string][]) =>
      keys.map(([key, action]) => `${styleText('bold', key)} ${styleText('dim', action)}`).join(styleText('dim', ' • ')),
  },
  keybindings: [] as string[],
};

function normalizeCheckboxChoices<V>(choices: ReadonlyArray<CheckboxChoice<V>>) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice)) return choice;
    if (typeof choice === 'string') {
      return { value: choice, name: choice, short: choice, checkedName: choice, disabled: false as const, checked: false };
    }
    const c = choice as any;
    const name = c.name ?? String(c.value);
    const norm: any = { value: c.value, name, short: c.short ?? name, checkedName: c.checkedName ?? name, disabled: c.disabled ?? false, checked: c.checked ?? false };
    if (c.description) norm.description = c.description;
    if (c.group) norm.group = c.group;
    return norm;
  });
}

function isChecked(item: any): boolean {
  return isSelectable(item) && item.checked;
}

function toggleItem(item: any) {
  return isSelectable(item) ? { ...item, checked: !item.checked } : item;
}

function checkAll(checked: boolean) {
  return (item: any) => (isSelectable(item) ? { ...item, checked } : item);
}

/**
 * A checkbox prompt that returns BACK when user presses Escape or left-arrow.
 */
export const checkboxWithBack = createPrompt<any, CheckboxConfig<any>>((config, done) => {
  const { pageSize = 7, loop = true, required, validate = () => true } = config;
  const shortcuts = { all: 'a', invert: 'i', ...config.shortcuts };
  const theme = makeTheme(defaultCheckboxTheme, config.theme);
  const [status, setStatus] = useState<Status>('idle');
  const [isBack, setIsBack] = useState(false);
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState(normalizeCheckboxChoices(config.choices));

  const bounds = useMemo(() => {
    const first = items.findIndex(isSelectable);
    const last = items.findLastIndex(isSelectable);
    if (first === -1) throw new ValidationError('[checkbox prompt] No selectable choices.');
    return { first, last };
  }, [items]);

  const [active, setActive] = useState(bounds.first);
  const [errorMsg, setError] = useState<string | undefined>();

  useKeypress(async (key) => {
    if (isBackKey(key)) {
      setIsBack(true);
      setStatus('done');
      done(BACK as any);
    } else if (isEnterKey(key)) {
      const selection = items.filter(isChecked);
      const isValid = await validate([...selection]);
      if (required && !items.some(isChecked)) {
        setError('At least one choice must be selected');
      } else if (isValid === true) {
        setStatus('done');
        done(selection.map((c: any) => c.value));
      } else {
        setError(typeof isValid === 'string' ? isValid : 'You must select a valid value');
      }
    } else if (isUpKey(key, []) || isDownKey(key, [])) {
      if (loop || (isUpKey(key, []) && active !== bounds.first) || (isDownKey(key, []) && active !== bounds.last)) {
        const offset = isUpKey(key, []) ? -1 : 1;
        let next = active;
        do { next = (next + offset + items.length) % items.length; } while (!isSelectable(items[next]));
        setActive(next);
      }
    } else if (isSpaceKey(key)) {
      setError(undefined);
      setItems(items.map((choice: any, i: number) => (i === active ? toggleItem(choice) : choice)));
    } else if (key.name === shortcuts.all) {
      const selectAll = items.some((choice: any) => isSelectable(choice) && !choice.checked);
      setItems(items.map(checkAll(selectAll)));
    } else if (key.name === shortcuts.invert) {
      setItems(items.map(toggleItem));
    } else if (shortcuts.folder && key.name === shortcuts.folder) {
      // Toggle all items sharing the same group as the active item
      const activeItem = items[active] as any;
      const group = activeItem?.group;
      if (group) {
        const groupItems = items.filter((item: any) => isSelectable(item) && item.group === group);
        const shouldCheck = groupItems.some((item: any) => !item.checked);
        setItems(items.map((item: any) => (isSelectable(item) && item.group === group ? { ...item, checked: shouldCheck } : item)));
      }
    } else if (isNumberKey(key)) {
      const selectedIndex = Number(key.name) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item: any) => {
        if (Separator.isSeparator(item)) return false;
        selectableIndex++;
        return selectableIndex === selectedIndex;
      });
      if (items[position] && isSelectable(items[position])) {
        setActive(position);
        setItems(items.map((choice: any, i: number) => (i === position ? toggleItem(choice) : choice)));
      }
    }
  });

  const message = theme.style.message(config.message, status);
  let description: string | undefined;

  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }: { item: any; isActive: boolean }) {
      if (Separator.isSeparator(item)) return ` ${item.separator}`;
      if (item.disabled) {
        const label = typeof item.disabled === 'string' ? item.disabled : '(disabled)';
        return theme.style.disabledChoice(`${item.name} ${label}`);
      }
      if (isActive) description = item.description;
      const cb = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const name = item.checked ? item.checkedName : item.name;
      const color = isActive ? theme.style.highlight : (x: string) => x;
      const cursor = isActive ? theme.icon.cursor : ' ';
      return color(`${cursor}${cb} ${name}`);
    },
    pageSize,
    loop,
  });

  if (status === 'done') {
    if (isBack) return '';
    const selection = items.filter(isChecked);
    const answer = theme.style.answer(theme.style.renderSelectedChoices(selection, items));
    return [prefix, message, answer].filter(Boolean).join(' ');
  }

  const keys: [string, string][] = [['↑↓', 'navigate'], ['space', 'select']];
  if (shortcuts.all) keys.push([shortcuts.all, 'all']);
  if (shortcuts.invert) keys.push([shortcuts.invert, 'invert']);
  if (shortcuts.folder) keys.push([shortcuts.folder, 'folder']);
  keys.push(['⏎', 'submit'], ['esc/←', 'back']);
  const helpLine = theme.style.keysHelpTip(keys);

  return [
    `${prefix} ${message}`,
    page,
    ' ',
    description ? theme.style.description(description) : '',
    errorMsg ? theme.style.error(errorMsg) : '',
    helpLine,
  ].filter(Boolean).join('\n').trimEnd() + cursorHide;
});



// ─── Group Assigner ───

/** Returned when user presses + to create a new group — includes current assignments so they aren't lost */
export interface NewGroupRequest {
  action: 'new_group';
  assignments: Map<string, string>;
}

/** Result returned by groupAssigner: BACK, a NewGroupRequest (with current assignments), or a confirmed Map */
export type GroupAssignerResult = BackSymbol | NewGroupRequest | Map<string, string>;

/** A repo entry for the group assigner — name is required, path is optional (shown dimmed). */
export interface GroupAssignerRepo {
  name: string;
  path?: string;
}

interface GroupAssignerConfig {
  message: string;
  /** Repos to assign */
  repos: GroupAssignerRepo[];
  /** Available group names (index 0 = Undefined, rest are 1-based) */
  groups: string[];
  /** Pre-existing assignments (repo name → group name). Unassigned repos default to 'Undefined'. */
  assignments?: Map<string, string>;
  pageSize?: number;
  theme?: any;
}

const defaultGroupAssignerTheme = {
  icon: { cursor: figures.pointer },
  style: {
    description: (text: string) => styleText('cyan', text),
    keysHelpTip: (keys: [string, string][]) =>
      keys.map(([key, action]) => `${styleText('bold', key)} ${styleText('dim', action)}`).join(styleText('dim', ' • ')),
  },
};

/**
 * Interactive group assignment prompt. Shows repos as a list; press 0-9 to assign
 * the highlighted repo to a numbered group. Press + to create a new group.
 * Enter confirms when all repos are assigned (none in Undefined).
 */
export const groupAssigner = createPrompt<GroupAssignerResult, GroupAssignerConfig>((config, done) => {
  const { pageSize = 15 } = config;
  const theme = makeTheme(defaultGroupAssignerTheme, config.theme);
  const [status, setStatus] = useState<Status>('idle');
  const [isBack, setIsBack] = useState(false);
  const prefix = usePrefix({ status, theme });
  const [errorMsg, setError] = useState<string | undefined>();

  // Build initial assignments
  const [assignments, setAssignments] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const repo of config.repos) {
      map.set(repo.name, config.assignments?.get(repo.name) ?? 'Undefined');
    }
    return map;
  });

  const groups = config.groups; // index 0 = 'Undefined', 1+ = real groups
  const [active, setActive] = useState(0);
  const repos = config.repos;

  useKeypress((key) => {
    if (isBackKey(key)) {
      setIsBack(true);
      setStatus('done');
      done(BACK as GroupAssignerResult);
    } else if (isEnterKey(key)) {
      const hasUndefined = Array.from(assignments.values()).some((g) => g === 'Undefined');
      if (hasUndefined) {
        setError('All repos must be assigned to a group before proceeding.');
      } else {
        setStatus('done');
        done(new Map(assignments) as GroupAssignerResult);
      }
    } else if (key.name === 'up' || (key.name === 'k' && !key.ctrl)) {
      setError(undefined);
      if (active > 0) setActive(active - 1);
    } else if (key.name === 'down' || (key.name === 'j' && !key.ctrl)) {
      setError(undefined);
      if (active < repos.length - 1) setActive(active + 1);
    } else if ((key as any).sequence === '+' || key.name === '+' || (key.name === '=' && key.shift)) {
      setStatus('done');
      done({ action: 'new_group', assignments: new Map(assignments) } as GroupAssignerResult);
    } else {
      // Check for digit keys 0-9
      const digit = parseInt(key.name, 10);
      if (!isNaN(digit) && digit >= 0 && digit < groups.length) {
        setError(undefined);
        const repo = repos[active];
        const newMap = new Map(assignments);
        newMap.set(repo.name, groups[digit]);
        setAssignments(newMap);
        // Auto-advance to next repo
        if (active < repos.length - 1) setActive(active + 1);
      }
    }
  });

  const message = theme.style.message(config.message, status);

  if (status === 'done') {
    if (isBack) return '';
    // For confirmed assignments, show summary
    const groupCounts = new Map<string, number>();
    for (const g of assignments.values()) {
      groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    }
    const summary = Array.from(groupCounts.entries())
      .filter(([g]) => g !== 'Undefined')
      .map(([g, n]) => `${g}(${n})`)
      .join(', ');
    return `${prefix} ${message} ${theme.style.answer(summary || 'done')}`;
  }

  // Build group legend line
  const legendParts = groups.map((g, i) => {
    const count = Array.from(assignments.values()).filter((a) => a === g).length;
    if (i === 0) {
      return count > 0
        ? styleText('yellow', `${i}=${g}(${count})`)
        : styleText('dim', `${i}=${g}(0)`);
    }
    return count > 0
      ? styleText('green', `${i}=${g}(${count})`)
      : styleText('dim', `${i}=${g}(0)`);
  });
  legendParts.push(styleText('cyan', '+=new'));
  const legend = `  Groups: ${legendParts.join('  ')}`;

  // Build repo lines grouped under their assigned group header
  // Collect repos by group, preserving group order
  const reposByGroup = new Map<string, { repo: GroupAssignerRepo; idx: number }[]>();
  for (const g of groups) reposByGroup.set(g, []);
  for (let i = 0; i < repos.length; i++) {
    const group = assignments.get(repos[i].name) ?? 'Undefined';
    reposByGroup.get(group)!.push({ repo: repos[i], idx: i });
  }

  // Render grouped lines: header + indented repos
  const groupedLines: { line: string; repoIdx: number | null }[] = [];
  for (const [gIdx, g] of groups.entries()) {
    const members = reposByGroup.get(g) ?? [];
    if (members.length === 0 && g !== 'Undefined') continue; // skip empty non-Undefined groups
    const headerColor = g === 'Undefined' ? 'yellow' : 'green';
    groupedLines.push({ line: styleText(headerColor, `  ── ${gIdx}:${g} (${members.length}) ──`), repoIdx: null });
    for (const { repo, idx } of members) {
      const cursor = idx === active ? styleText('cyan', figures.pointer) : ' ';
      const name = idx === active ? styleText('bold', repo.name) : repo.name;
      const pathSuffix = repo.path ? styleText('dim', ` ${repo.path}`) : '';
      groupedLines.push({ line: `  ${cursor} ${name}${pathSuffix}`, repoIdx: idx });
    }
  }

  // Paginate around the active item
  const activeLineIdx = groupedLines.findIndex((l) => l.repoIdx === active);
  const totalLines = groupedLines.length;
  const startIdx = Math.max(0, Math.min(activeLineIdx - Math.floor(pageSize / 2), totalLines - pageSize));
  const visibleLines = groupedLines.slice(startIdx, startIdx + pageSize).map((l) => l.line);

  const keys: [string, string][] = [['↑↓', 'navigate'], ['0-9', 'assign group'], ['+', 'new group'], ['⏎', 'confirm'], ['esc/←', 'back']];
  const helpLine = theme.style.keysHelpTip(keys);

  return [
    `${prefix} ${message}`,
    legend,
    '',
    ...visibleLines,
    '',
    errorMsg ? styleText('red', `  ⚠ ${errorMsg}`) : '',
    helpLine,
  ].filter((line) => line !== undefined).join('\n').trimEnd() + cursorHide;
});