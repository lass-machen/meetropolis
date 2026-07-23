import type { AvatarConfig, SpriteCatalog } from '@meetropolis/shared';
import {
  isHairReplaced,
  isOptionEnabled,
  offersNone,
  optionsForField,
  prettyValue,
  setField,
  type SlotGroup,
} from './slotConfig';
import { groupsForTab, isColorField } from './editorLayout';
import { SpriteTile } from './SpriteTile';
import { SwatchTile } from './SwatchTile';

interface Props {
  catalog: SpriteCatalog;
  config: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
}

interface Option {
  value: string | null;
  label: string;
}

function optionsFor(catalog: SpriteCatalog, field: string): Option[] {
  const options: Option[] = [];
  if (offersNone(field)) options.push({ value: null, label: 'Ohne' });
  for (const value of optionsForField(catalog, field)) options.push({ value, label: prettyValue(value) });
  return options;
}

/** One labelled slot: its options as swatch or sprite tiles. */
function SlotGroupRow({ catalog, config, group, onChange }: Props & { group: SlotGroup }) {
  const { field, label } = group;
  const replaced = field === 'hair' && isHairReplaced(catalog, config);
  const current = config[field] ?? null;
  const color = isColorField(field);

  return (
    <div>
      <div className="av-ed__slot-label">
        {label}
        {replaced && <span className="av-ed__slot-note">von der Kapuze verdeckt</span>}
      </div>
      <div className={`av-ed__grid av-ed__grid--${color ? 'swatch' : 'sprite'}`} role="group" aria-label={label}>
        {optionsFor(catalog, field).map((opt) => {
          const selected = current === opt.value;
          const enabled = !replaced && (opt.value === null || isOptionEnabled(catalog, config, field, opt.value));
          // The config this option would produce: what the tile shows is exactly
          // what the click applies, repaired invariants included.
          const next = setField(catalog, config, field, opt.value);
          const key = opt.value ?? '__none';

          if (color && opt.value !== null) {
            return (
              <SwatchTile
                key={key}
                catalog={catalog}
                field={field}
                value={opt.value}
                label={opt.label}
                selected={selected}
                disabled={!enabled}
                onClick={() => onChange(next)}
              />
            );
          }
          return (
            <SpriteTile
              key={key}
              catalog={catalog}
              previewConfig={next}
              label={opt.label}
              selected={selected}
              disabled={!enabled}
              none={opt.value === null}
              onClick={() => onChange(next)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The slot groups of the active category. Inapplicable slots stay hidden. */
export function SlotPicker({ catalog, config, onChange, tabKey }: Props & { tabKey: string }) {
  return (
    <div className="av-ed__slots">
      {groupsForTab(catalog, config, tabKey).map((group) => (
        <SlotGroupRow key={group.field} catalog={catalog} config={config} group={group} onChange={onChange} />
      ))}
    </div>
  );
}

export default SlotPicker;
