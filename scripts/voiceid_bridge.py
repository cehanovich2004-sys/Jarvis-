#!/usr/bin/env python3
"""Private JSONL bridge from JARVIS to the read-only VoiceID runtime."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any

import numpy as np

from voiceid.audio.preprocessing import (
    PreprocessedAudioMetadata,
    PreprocessedAudioResult,
    PreprocessingStatus,
    preprocess_validated_waveform,
)
from voiceid.embeddings.backends.speechbrain_ecapa import (
    SpeechBrainEcapaBackendFactory,
    default_speechbrain_ecapa_config,
)
from voiceid.embeddings.contracts import (
    EmbeddingMetadata,
    EmbeddingStatus,
    SpeakerEmbeddingResult,
)
from voiceid.embeddings.loader import EmbeddingModelLoader
from voiceid.services.speaker_embedding import SpeakerEmbeddingService
from voiceid.services import preprocess_wav_file
from voiceid.similarity.comparison import compare_speaker_embeddings

MAX_AUDIO_BYTES = 16_000 * 30 * 4
EMBEDDING_DIMENSION = 192


def _service() -> SpeakerEmbeddingService:
    cache_dir = os.environ.get("JARVIS_VOICEID_CACHE_DIR", "")
    if not cache_dir:
        raise RuntimeError("MODEL_CACHE_MISSING")
    config = default_speechbrain_ecapa_config(cache_dir=cache_dir, offline=True)
    loader = EmbeddingModelLoader(SpeechBrainEcapaBackendFactory(config))
    return SpeakerEmbeddingService(loader=loader)


def _audio(payload: dict[str, Any]) -> PreprocessedAudioResult:
    if payload.get("sampleRateHz") != 16_000 or payload.get("channels") != 1:
        raise ValueError("UNSUPPORTED_SAMPLE_RATE")
    encoded = payload.get("audioBase64")
    if not isinstance(encoded, str):
        raise ValueError("INVALID_PREPROCESSED_AUDIO")
    raw = base64.b64decode(encoded, validate=True)
    if not raw or len(raw) > MAX_AUDIO_BYTES or len(raw) % 4 != 0:
        raise ValueError("INVALID_PREPROCESSED_AUDIO")
    source = np.frombuffer(raw, dtype="<f4").astype(np.float32, copy=True)
    if not np.all(np.isfinite(source)):
        raise ValueError("NON_FINITE_WAVEFORM")
    waveform, downmixed, resampled, up, down, clipped = preprocess_validated_waveform(
        waveform=source,
        source_sample_rate_hz=16_000,
    )
    duration = round(float(source.shape[0]) / 16_000, 6)
    output_duration = round(float(waveform.shape[0]) / 16_000, 6)
    return PreprocessedAudioResult(
        status=PreprocessingStatus.VALID,
        file_name="jarvis-memory-audio",
        waveform=waveform,
        metadata=PreprocessedAudioMetadata(
            source_sample_rate_hz=16_000,
            source_channels=1,
            source_duration_seconds=duration,
            output_sample_rate_hz=16_000,
            output_channels=1,
            output_samples=int(waveform.shape[0]),
            output_duration_seconds=output_duration,
            downmixed_to_mono=downmixed,
            dc_offset_removed=True,
            resampled=resampled,
            resample_up=up,
            resample_down=down,
            safety_clipped=clipped,
        ),
        errors=(),
    )


def _metadata(payload: dict[str, Any]) -> EmbeddingMetadata:
    return EmbeddingMetadata(
        embedding_dimension=int(payload["embeddingDimension"]),
        model_identifier=str(payload["modelIdentifier"]),
        model_revision=str(payload["modelRevision"]),
        backend_name=str(payload["backendName"]),
        backend_version=str(payload["backendVersion"]),
        preprocessing_contract_version=str(payload["preprocessingContractVersion"]),
        embedding_contract_version=str(payload["embeddingContractVersion"]),
        device="cpu",
        input_sample_rate_hz=int(payload["inputSampleRateHz"]),
        input_samples=16_000,
        input_duration_seconds=1.0,
        normalized=bool(payload["normalized"]),
    )


def _embedding(values: Any, metadata: EmbeddingMetadata) -> SpeakerEmbeddingResult:
    vector = np.asarray(values, dtype=np.float32)
    if vector.shape != (EMBEDDING_DIMENSION,) or not np.all(np.isfinite(vector)):
        raise ValueError("INVALID_EMBEDDING")
    vector.setflags(write=False)
    return SpeakerEmbeddingResult(
        status=EmbeddingStatus.VALID,
        embedding=vector,
        metadata=metadata,
        errors=(),
    )


def _extract(service: SpeakerEmbeddingService, payload: dict[str, Any]) -> dict[str, Any]:
    result = service.embed(_audio(payload))
    return _serialize_embedding(result)


def _serialize_embedding(result: Any) -> dict[str, Any]:
    if not result.is_valid or result.embedding is None or result.metadata is None:
        code = result.errors[0].code if result.errors else "INFERENCE_FAILED"
        return {"status": "INVALID", "errorCode": code}
    metadata = result.metadata.to_dict()
    return {
        "status": "VALID",
        "embedding": result.embedding.tolist(),
        "metadata": {
            "embeddingDimension": metadata["embedding_dimension"],
            "modelIdentifier": metadata["model_identifier"],
            "modelRevision": metadata["model_revision"],
            "backendName": metadata["backend_name"],
            "backendVersion": metadata["backend_version"],
            "preprocessingContractVersion": metadata["preprocessing_contract_version"],
            "embeddingContractVersion": metadata["embedding_contract_version"],
            "inputSampleRateHz": metadata["input_sample_rate_hz"],
            "normalized": metadata["normalized"],
        },
    }


def _import_enrollment(service: SpeakerEmbeddingService, payload: dict[str, Any]) -> dict[str, Any]:
    participant_code = payload.get("participantCode")
    if not isinstance(participant_code, str) or len(participant_code) != 5 or not participant_code.startswith("P") or not participant_code[1:].isdigit():
        raise ValueError("INVALID_REQUEST")
    data_dir_raw = os.environ.get("JARVIS_VOICEID_DATA_DIR", "")
    if not data_dir_raw:
        raise ValueError("INVALID_REQUEST")
    data_dir = Path(data_dir_raw).resolve(strict=True)
    database = data_dir / "state" / "voice_collection.sqlite3"
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT v.wav_path
            FROM participant_codes c
            JOIN voice_samples v ON v.telegram_user_id = c.telegram_user_id
            WHERE c.participant_code = ?
            ORDER BY v.prompt_index
            """,
            (participant_code,),
        ).fetchall()
    finally:
        connection.close()
    if len(rows) < 2 or len(rows) > 16:
        raise ValueError("PROFILE_NOT_FOUND")
    embeddings = []
    audio_root = (data_dir / "audio").resolve(strict=True)
    for row in rows:
        wav_path = Path(str(row[0])).resolve(strict=True)
        if not wav_path.is_relative_to(audio_root):
            raise ValueError("INVALID_REQUEST")
        embeddings.append(_serialize_embedding(service.embed(preprocess_wav_file(wav_path))))
    if any(item.get("status") != "VALID" for item in embeddings):
        raise ValueError("INFERENCE_FAILED")
    return {"status": "VALID", "participantCode": participant_code, "embeddings": embeddings}


def _compare(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = _metadata(payload["metadata"])
    result = compare_speaker_embeddings(
        _embedding(payload["reference"], metadata),
        _embedding(payload["candidate"], metadata),
    )
    if not result.is_valid or result.similarity is None or result.metadata is None:
        code = result.errors[0].code if result.errors else "COMPARISON_ERROR"
        return {"status": "INVALID", "errorCode": code}
    public = result.metadata.to_dict()
    return {
        "status": "VALID",
        "similarity": result.similarity,
        "metric": public["metric"],
        "comparisonVersion": public["comparison_version"],
        "embeddingDimension": public["embedding_dimension"],
        "normalized": public["normalized"],
    }


def main() -> int:
    try:
        service = _service()
    except Exception:
        service = None
    for line in sys.stdin:
        request_id: Any = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            operation = request.get("operation")
            payload = request.get("payload")
            if not isinstance(request_id, int) or not isinstance(payload, dict):
                raise ValueError("INVALID_REQUEST")
            if operation == "extract":
                if service is None:
                    response = {"status": "INVALID", "errorCode": "MODEL_CACHE_MISSING"}
                else:
                    response = _extract(service, payload)
            elif operation == "compare":
                response = _compare(payload)
            elif operation == "importEnrollment":
                if service is None:
                    response = {"status": "INVALID", "errorCode": "MODEL_CACHE_MISSING"}
                else:
                    response = _import_enrollment(service, payload)
            else:
                raise ValueError("INVALID_REQUEST")
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            code = str(exc) if str(exc).isupper() else "INFERENCE_FAILED"
            response = {"status": "INVALID", "errorCode": code}
        sys.stdout.write(json.dumps({"id": request_id, "result": response}, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
