import { AVATARS, type AvatarId } from "@facecards/shared";

/**
 * Who you turn up as.
 *
 * A radio group, not a carousel: six is few enough to show at once, and seeing
 * all of them together is how someone picks the one nobody else has. The
 * swatch is the archetype's actual body colour from `shared/src/avatars.ts`,
 * which is the same value the scene builds the torso from - so what is chosen
 * here is recognisably what sits down.
 *
 * Native inputs, so arrow keys move between archetypes and the whole thing
 * works without a mouse. That matters more than usual here: this is the last
 * screen before a room where the mouse belongs to the camera.
 */
export function AvatarPicker({
  value,
  onChange,
  disabled,
}: {
  value: AvatarId;
  onChange(id: AvatarId): void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="picker" disabled={disabled}>
      <legend className="picker__legend">Sit down as</legend>
      <div className="picker__grid" role="radiogroup" aria-label="Avatar">
        {AVATARS.map((avatar) => {
          const selected = avatar.id === value;
          return (
            <label
              key={avatar.id}
              className={`picker__option${selected ? " picker__option--on" : ""}`}
            >
              <input
                type="radio"
                name="avatar"
                value={avatar.id}
                checked={selected}
                onChange={() => onChange(avatar.id)}
              />
              <span
                className="picker__swatch"
                aria-hidden="true"
                style={{
                  background: avatar.colour,
                  borderColor: avatar.accent,
                }}
              />
              <span className="picker__label">{avatar.label}</span>
              <span className="picker__blurb">{avatar.blurb}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
