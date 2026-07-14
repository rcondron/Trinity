from motion_service.prompts import locomotion_params, prompt_to_clip


def test_gesture_vocabulary_mapping():
    assert prompt_to_clip("wave hello") == "wave"
    assert prompt_to_clip("nod in agreement") == "nod"
    assert prompt_to_clip("hand on chin thinking") == "think"
    assert prompt_to_clip("lean forward attentively") == "lean_forward"
    assert prompt_to_clip("open arms welcoming") == "open_arms"
    assert prompt_to_clip("pace slowly") == "walk"
    assert prompt_to_clip("stand at ease") == "idle"


def test_unknown_prompt_defaults_to_idle():
    assert prompt_to_clip("do a backflip through a flaming hoop") == "idle"


def test_locomotion_prefix():
    assert prompt_to_clip("locomotion:pace:0.5") == "walk"
    assert prompt_to_clip("locomotion:idle") == "idle"
    mode, speed = locomotion_params("locomotion:pace:0.75")
    assert mode == "pace"
    assert speed == 0.75


def test_locomotion_speed_clamped_and_defaulted():
    assert locomotion_params("locomotion:pace:99")[1] == 2.0
    assert locomotion_params("locomotion:pace")[1] == 0.5
    assert locomotion_params("locomotion:pace:abc")[1] == 0.5
