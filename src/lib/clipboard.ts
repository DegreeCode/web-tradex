import { toast } from "sonner";

/** Copies text and reports the outcome; resolves to whether it worked. */
export async function copyToClipboard(text: string, successMessage: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  } catch {
    toast.error("복사하지 못했어요. 직접 선택해 복사해주세요");
    return false;
  }
}
