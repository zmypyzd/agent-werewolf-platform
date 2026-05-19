export type WerewolfChannelChipVariant = 'gpt' | 'claude' | 'llama' | 'neutral';

export interface WerewolfChannelChip {
  label: string;
  variant?: WerewolfChannelChipVariant;
}

export interface WerewolfChannelCardRoleArt {
  src: string;
  alt: string;
}

export interface WerewolfChannelCardProps {
  title: string;
  sub?: string | undefined;
  chips?: ReadonlyArray<WerewolfChannelChip> | undefined;
  // Optional. When omitted, a placeholder ROLE ROSTER label is shown. Role
  // art will be wired in a follow-up PR once the asset pipeline lands.
  roleArt?: ReadonlyArray<WerewolfChannelCardRoleArt> | undefined;
}

function chipClassName(variant: WerewolfChannelChipVariant | undefined): string {
  switch (variant) {
    case 'gpt':
      return 'ww-chip is-gpt';
    case 'claude':
      return 'ww-chip is-claude';
    case 'llama':
      return 'ww-chip is-llama';
    case 'neutral':
    case undefined:
      return 'ww-chip';
  }
}

export function WerewolfChannelCard({
  title,
  sub,
  chips,
  roleArt,
}: WerewolfChannelCardProps) {
  return (
    <section className="ww-channel-card" aria-label="Match channel card">
      <div className="ww-channel-card-roles" aria-label="Role roster">
        {roleArt && roleArt.length > 0 ? (
          roleArt.map((art) => <img key={art.alt} src={art.src} alt={art.alt} />)
        ) : (
          <span className="ww-channel-card-roles-placeholder" aria-hidden="true">
            Role roster
          </span>
        )}
      </div>
      <div className="ww-channel-card-meta">
        <div className="ww-channel-card-title">{title}</div>
        {sub ? <div className="ww-channel-card-sub">{sub}</div> : null}
        {chips && chips.length > 0 ? (
          <div className="ww-channel-card-chips">
            {chips.map((chip) => (
              <span key={chip.label} className={chipClassName(chip.variant)}>
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {/* CTA stack reserved for FOLLOW BROADCAST + INVITE A FRIEND once a
          backend exists for either. The approved finalized.html keeps the
          slot hidden — same here. */}
      <div className="ww-channel-card-cta" aria-hidden="true" />
    </section>
  );
}
