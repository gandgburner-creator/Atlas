import { Button } from '../components/Button';
import { SketchCard } from '../components/Sketch';
import { PROFILE_NAME, PROFILES, type Profile } from '../domain/duo';

/** Asked once per device; the answer is remembered and switchable from the header. */
export function ProfileGate({ onPick }: { onPick: (p: Profile) => void }) {
  return (
    <div className="flex flex-col gap-5 pt-10">
      <h1 className="hand text-[44px] leading-none">Who's training?</h1>
      <SketchCard className="flex flex-col gap-3 px-5 py-5">
        {PROFILES.map((p) => (
          <Button key={p} className="w-full" onClick={() => onPick(p)}>
            {PROFILE_NAME[p]}
          </Button>
        ))}
        <p className="caption">You can switch from the header any time.</p>
      </SketchCard>
    </div>
  );
}
