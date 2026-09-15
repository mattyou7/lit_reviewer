Student training plan:

Teacher = Qwen3-1.7B.
Student target = Qwen3-0.6B.

Distillation dataset should contain paper chunks and teacher-produced structured evidence, preferably with evidence spans. Fine-tuning should teach the student the narrow extraction schema rather than general chat behavior.

Do not train the student until the teacher dataset has been inspected and quality-checked.
