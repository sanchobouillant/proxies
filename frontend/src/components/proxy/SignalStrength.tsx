import { Signal, SignalHigh, SignalLow, SignalMedium, SignalZero } from "lucide-react";

export const SignalStrength = ({ quality }: { quality?: number }) => {
    if (quality === undefined || quality === null) return <SignalZero className="text-gray-400" />;

    // Quality is 0-100
    if (quality >= 75) return <SignalHigh className="text-green-500" />;
    if (quality >= 50) return <SignalMedium className="text-yellow-500" />;
    if (quality >= 25) return <SignalLow className="text-orange-500" />;
    return <SignalZero className="text-red-500" />;
};
