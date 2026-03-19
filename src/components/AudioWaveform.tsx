import { motion } from "framer-motion";

interface AudioWaveformProps {
  isPlaying: boolean;
  barCount?: number;
}

const AudioWaveform = ({ isPlaying, barCount = 32 }: AudioWaveformProps) => {
  return (
    <div className="flex items-end justify-center gap-[2px] h-16 px-4">
      {Array.from({ length: barCount }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-primary"
          initial={{ height: 4 }}
          animate={
            isPlaying
              ? {
                  height: [4, Math.random() * 48 + 12, 8, Math.random() * 56 + 8, 4],
                }
              : { height: 4 }
          }
          transition={
            isPlaying
              ? {
                  duration: 0.6 + Math.random() * 0.6,
                  repeat: Infinity,
                  repeatType: "reverse",
                  delay: Math.random() * 0.3,
                  ease: "easeInOut",
                }
              : { duration: 0.3 }
          }
        />
      ))}
    </div>
  );
};

export default AudioWaveform;
