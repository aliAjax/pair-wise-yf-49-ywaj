import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { Clearance, CustodyRecord, Evidence } from "../types";

const KEY = "pair-wise-yf-49/court";

export interface CourtBundle {
  evidence?: Evidence[];
  custody?: CustodyRecord[];
  clearances?: Clearance[];
}

export const courtApi = createApi({
  reducerPath: "courtApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getCourt: builder.query<CourtBundle, void>({
      queryFn: async () => {
        const raw = localStorage.getItem(KEY);
        return { data: raw ? (JSON.parse(raw) as CourtBundle) : {} };
      }
    }),
    saveCourt: builder.mutation<{ ok: true }, CourtBundle>({
      queryFn: async (payload) => {
        const raw = localStorage.getItem(KEY);
        const current = raw ? JSON.parse(raw) : {};
        localStorage.setItem(KEY, JSON.stringify({ ...current, ...payload }));
        return { data: { ok: true } };
      }
    })
  })
});

export const { useGetCourtQuery, useSaveCourtMutation } = courtApi;
