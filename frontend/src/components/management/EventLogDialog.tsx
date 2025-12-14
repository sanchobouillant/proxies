
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { EventLogViewer } from "../dashboard/EventLogViewer";

interface EventLogDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityId: string | null;
    entityName?: string;
}

export function EventLogDialog({ open, onOpenChange, entityId, entityName }: EventLogDialogProps) {
    if (!entityId) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>History for {entityName || entityId}</DialogTitle>
                </DialogHeader>
                <div className="mt-4">
                    <EventLogViewer entityId={entityId} title={`Logs for ${entityName || entityId}`} className="border-0 shadow-none" />
                </div>
            </DialogContent>
        </Dialog>
    );
}
