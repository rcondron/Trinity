"""SOMA-24 skeleton — MUST stay in lockstep with packages/protocol/src/skeleton.ts.

The wire format orders PoseFrame.rotations exactly by SOMA_JOINTS.
"""

SOMA_JOINTS: tuple[str, ...] = (
    "pelvis",
    "left_hip",
    "right_hip",
    "spine1",
    "left_knee",
    "right_knee",
    "spine2",
    "left_ankle",
    "right_ankle",
    "spine3",
    "left_foot",
    "right_foot",
    "neck",
    "left_collar",
    "right_collar",
    "head",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hand",
    "right_hand",
)

JOINT_INDEX: dict[str, int] = {name: i for i, name in enumerate(SOMA_JOINTS)}
JOINT_COUNT = len(SOMA_JOINTS)

# Rest hip height of the SOMA reference body (meters); rootPos is in this scale.
REST_HIPS_Y = 0.95
