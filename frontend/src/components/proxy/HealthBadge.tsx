import { Badge } from "@/components/ui/badge";
import { SystemHealth } from "@proxy-farm/shared";
import { AlertTriangle, Thermometer, Zap } from "lucide-react";

export const HealthBadge = ({ health }: { health?: SystemHealth }) => {
    if (!health) return null;

    return (
        <div className="flex gap-2">
            {health.undervoltageDetected && (
                <Badge variant="destructive" className="flex items-center gap-1">
                    <Zap size={14} /> Low Voltage
                </Badge>
            )}
            {health.cpuTemp && health.cpuTemp > 80 && (
                <Badge variant="destructive" className="flex items-center gap-1">
                    <Thermometer size={14} /> {health.cpuTemp}°C
                </Badge>
            )}
            {health.cpuTemp && health.cpuTemp <= 80 && (
                <Badge variant="outline" className="flex items-center gap-1 text-gray-500">
                    <Thermometer size={14} /> {health.cpuTemp}°C
                </Badge>
            )}
            <Badge variant="secondary">RAM {health.memoryUsage}%</Badge>
        </div>
    );
};
