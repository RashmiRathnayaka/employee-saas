import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export type PickedProofFile = { uri: string; name: string; mimeType: string; sizeBytes: number };

export class ProofPickerPermissionError extends Error {}

// Resizes to a max width and recompresses as JPEG so a phone photo (often
// several MB straight off the camera) lands well under the 5 MB proof limit
// before validateProofFile even runs. Reads the resulting size directly off
// the saved file (`File#size`, a plain filesystem stat) rather than asking
// saveAsync for `base64: true` - requesting base64 round-trips the whole
// image through the JS bridge as a giant string just to measure it, which on
// a real device either throws or silently poisons the rest of the upload
// (this was reproduced on a real Android device: the picker, compress, and
// upload all looked fine in code, but no request ever reached the API).
async function compressImage(uri: string): Promise<{ uri: string; sizeBytes: number }> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
  const result = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
  const file = new File(result.uri);
  return { uri: result.uri, sizeBytes: file.exists ? file.size : 0 };
}

async function toProofFile(uri: string): Promise<PickedProofFile> {
  const compressed = await compressImage(uri);
  return {
    uri: compressed.uri,
    name: `proof-${Date.now()}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: compressed.sizeBytes,
  };
}

export async function pickProofFromCamera(): Promise<PickedProofFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new ProofPickerPermissionError();
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  return toProofFile(result.assets[0].uri);
}

export async function pickProofFromGallery(): Promise<PickedProofFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ProofPickerPermissionError();
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
  if (result.canceled || !result.assets[0]) return null;
  return toProofFile(result.assets[0].uri);
}

export async function pickProofDocument(): Promise<PickedProofFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/jpeg", "image/png", "application/pdf"],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? "application/octet-stream",
    sizeBytes: asset.size ?? 0,
  };
}
