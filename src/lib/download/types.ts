export type DownloadArtworkPayload = {
  id: string;
  title: string | null;
  titleKo: string | null;
  titleEn: string | null;
  year: number | null;
  medium: string | null;
  mediumKo: string | null;
  mediumEn: string | null;
  size: string | null;
  sizeUnit: "cm" | "in" | null;
  displayPath: string;
  artistName: string | null;
  artistNameKo: string | null;
  artistNameEn: string | null;
  username: string | null;
  role: string | null;
};

export type DownloadPosterPayload = {
  displayPath: string;
  kind: "image" | "pdf";
};

export type ExhibitionPackPayload = {
  id: string;
  title: string | null;
  prefaceKo: string | null;
  prefaceEn: string | null;
  posters: DownloadPosterPayload[];
  works: DownloadArtworkPayload[];
};
