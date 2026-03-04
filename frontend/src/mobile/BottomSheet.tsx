import { useRef, useCallback, useEffect, type ReactNode } from 'react';
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion';

export type SheetState = 'peek' | 'half' | 'full';

interface BottomSheetProps {
  children: ReactNode;
  state: SheetState;
  onStateChange: (state: SheetState) => void;
}

function getSnapPoints() {
  return {
    peek: 140,
    half: window.innerHeight * 0.5,
    full: window.innerHeight * 0.88,
  };
}

export default function BottomSheet({ children, state, onStateChange }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue(getSnapPoints()[state]);

  // Sync sheet position when state changes from parent (e.g., tracking starts)
  useEffect(() => {
    const sp = getSnapPoints();
    animate(height, sp[state], {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    });
  }, [state, height]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const currentHeight = height.get();
    const velocity = info.velocity.y;
    const sp = getSnapPoints();

    let target: SheetState;
    if (velocity < -500) {
      target = currentHeight > sp.half ? 'full' : 'half';
    } else if (velocity > 500) {
      target = currentHeight < sp.half ? 'peek' : 'half';
    } else {
      const distances = (Object.entries(sp) as [SheetState, number][]).map(([key, val]) => ({
        state: key,
        dist: Math.abs(currentHeight - val),
      }));
      target = distances.sort((a, b) => a.dist - b.dist)[0].state;
    }

    animate(height, sp[target], {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    });
    onStateChange(target);
  }, [height, onStateChange]);

  return (
    <motion.div
      ref={sheetRef}
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height,
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        borderRadius: '16px 16px 0 0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        touchAction: 'none',
      }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.1}
      onDrag={(_, info) => {
        const sp = getSnapPoints();
        const newHeight = sp[state] - info.offset.y;
        height.set(Math.max(sp.peek, Math.min(sp.full, newHeight)));
      }}
      onDragEnd={handleDragEnd}
    >
      {/* Drag handle */}
      <div style={{
        padding: '10px 0 6px',
        display: 'flex',
        justifyContent: 'center',
        cursor: 'grab',
        flexShrink: 0,
      }}>
        <div style={{
          width: 36,
          height: 4,
          background: 'var(--border-bright)',
          borderRadius: 2,
        }} />
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: state === 'peek' ? 'hidden' : 'auto',
        padding: '0 16px 16px',
        WebkitOverflowScrolling: 'touch',
      }}>
        {children}
      </div>
    </motion.div>
  );
}
