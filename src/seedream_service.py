"""
SeeDream 5.0 API Service
Virtual try-on functionality
"""

import os
import logging
from typing import Optional
from dataclasses import dataclass
import requests

logger = logging.getLogger(__name__)


@dataclass
class TryOnResult:
    success: bool
    image: Optional[str]
    error: Optional[str]


class SeeDreamService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("ARK_API_KEY")
        if not self.api_key:
            raise ValueError("ARK_API_KEY not found")
        self.base_url = "https://ark.cn-beijing.volces.com/api/v3"
        self.model_name = "doubao-seedream-5-0-260128"

    def generate_tryon(self, user_image_b64: str, cloth_image_b64: str) -> TryOnResult:
        try:
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }

            payload = {
                "model": self.model_name,
                "prompt": "**图2**的人物穿上**图1**的服装，保持**图2**人物的面容和身材特征不变。务必保证前后的**服装**一致性，保证人物的**肢体动作**一致性",
                "image": [
                    f"data:image/png;base64,{cloth_image_b64}",
                    f"data:image/jpeg;base64,{user_image_b64}"
                ],
                "size": "2k",
                "output_format": "png"
            }

            response = requests.post(
                f"{self.base_url}/images/generations",
                headers=headers,
                json=payload,
                timeout=120
            )

            if response.status_code != 200:
                error_detail = response.json() if response.content else {"error": {"message": response.text}}
                logger.error(f"SeeDream API error: {error_detail}")
                return TryOnResult(success=False, image=None, error=str(error_detail))

            data = response.json()
            if data.get("data") and len(data["data"]) > 0:
                img_url = data["data"][0].get("url")
                if img_url:
                    return TryOnResult(success=True, image=img_url, error=None)

            logger.error("SeeDream returned empty response")
            return TryOnResult(success=False, image=None, error="No image in response")

        except Exception as e:
            logger.error(f"SeeDream error: {e}")
            return TryOnResult(success=False, image=None, error=str(e))


def create_service() -> SeeDreamService:
    return SeeDreamService()
