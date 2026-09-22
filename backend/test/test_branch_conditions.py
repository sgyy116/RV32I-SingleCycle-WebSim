#!/usr/bin/env python3
"""回归测试：六种 RV32I 条件分支的 taken 语义。"""

import os
import platform
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "python"))

import asm  # noqa: E402
from test_sim import SIM, Sim  # noqa: E402


CASES = [
    ("beq", 7, 7, True),
    ("beq", 7, 8, False),
    ("bne", 7, 8, True),
    ("bne", 7, 7, False),
    ("blt", -1, 1, True),
    ("blt", 1, -1, False),
    ("bge", 1, -1, True),
    ("bge", -1, 1, False),
    ("bltu", 1, 2, True),
    ("bltu", 2, 1, False),
    ("bgeu", 2, 1, True),
    ("bgeu", 1, 2, False),
]


def run_case(op, lhs, rhs):
    source = f"""
        addi t0, zero, {lhs}
        addi t1, zero, {rhs}
        {op} t0, t1, target
        addi t2, zero, 1
        jal zero, done
    target:
        addi t2, zero, 2
    done:
        ecall
    """
    words = asm.assemble(source.splitlines())
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
        binary = f.name
        for word in words:
            f.write(word.to_bytes(4, "little"))

    sim = Sim(binary)
    branch_state = None
    try:
        for _ in range(32):
            message = sim.step()
            state = message.get("state", {})
            if state.get("disassembly", "").startswith(op + " "):
                branch_state = state
            if state.get("halted"):
                break
    finally:
        sim.close()
        os.unlink(binary)

    if branch_state is None:
        raise AssertionError(f"未找到 {op} 的执行周期")

    pc = int(branch_state["pc"], 16)
    next_pc = int(branch_state["next_pc"], 16)
    expected_next = pc + 12 if branch_state["branch"]["taken"] else pc + 4
    return branch_state["branch"]["taken"], next_pc == expected_next


def main():
    if not os.path.exists(SIM):
        print("请先编译 backend/cpp/build/rv32i_sim")
        return 1

    failures = []
    for op, lhs, rhs, expected_taken in CASES:
        actual_taken, target_ok = run_case(op, lhs, rhs)
        if actual_taken != expected_taken or not target_ok:
            failures.append(
                f"{op} {lhs},{rhs}: taken={actual_taken}, expected={expected_taken}, target_ok={target_ok}"
            )

    if failures:
        print("条件分支回归失败：")
        for failure in failures:
            print("  - " + failure)
        return 1

    print(f"条件分支回归通过：{len(CASES)} 个取/不取分支场景")
    return 0


if __name__ == "__main__":
    sys.exit(main())
