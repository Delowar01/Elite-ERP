import type { CropConfig } from "./crop-image-upload";

// Per-asset crop presets + exact output sizes. Server-side validation enforces the same dimensions.
export const CROP_SEAL: CropConfig = { title: "Upload Seal", format: "png", presets: [{ label: "1:1", aspect: 1, width: 600, height: 600 }] };
export const CROP_SIGNATURE: CropConfig = { title: "Upload Signature", format: "png", presets: [{ label: "3:1", aspect: 3, width: 1200, height: 400 }] };
export const CROP_ITEM_IMAGE: CropConfig = { title: "Add Image", format: "png", presets: [{ label: "1:1", aspect: 1, width: 800, height: 800 }] };
export const CROP_EMPLOYEE_PHOTO: CropConfig = { title: "Employee Photo", format: "png", presets: [{ label: "1:1", aspect: 1, width: 512, height: 512 }] };
// Logos allow a square or a wide preset (do not force one ratio).
export const CROP_LOGO: CropConfig = {
  title: "Company Logo",
  format: "png",
  presets: [
    { label: "Square", aspect: 1, width: 800, height: 800 },
    { label: "Wide", aspect: 3, width: 1200, height: 400 },
  ],
};
export const CROP_PARTY_LOGO: CropConfig = {
  title: "Logo",
  format: "png",
  presets: [
    { label: "Square", aspect: 1, width: 800, height: 800 },
    { label: "Wide", aspect: 3, width: 1200, height: 400 },
  ],
};
