defmodule NexusSocket.SupervisionTest do
  use ExUnit.Case, async: false

  describe "OTP Supervision Tree & Crash Isolation (F12)" do
    test "verifies root supervisor is alive and running with expected children" do
      supervisor_pid = Process.whereis(NexusSocket.Supervisor)
      assert is_pid(supervisor_pid)
      assert Process.alive?(supervisor_pid)

      children = Supervisor.which_children(supervisor_pid)
      child_modules = Enum.map(children, fn {id, _pid, _type, _modules} -> id end)

      # Verify core supervision tree components
      assert NexusSocket.Telemetry in child_modules
      assert NexusSocket.Auth.Cache in child_modules
      assert Phoenix.PubSub.Supervisor in child_modules
      assert NexusSocket.Presence.Tracker in child_modules
      assert NexusSocket.AiStreamBuffer in child_modules
      assert NexusSocket.ConnectionSupervisor in child_modules
      assert Enum.any?(child_modules, fn id -> match?({Bandit, _}, id) end)
    end

    test "recovers cleanly when Cache owner process exits" do
      cache_pid_before = Process.whereis(NexusSocket.Auth.Cache)
      assert is_pid(cache_pid_before)

      # Insert sample token into ETS
      NexusSocket.Auth.Cache.put("crash-test-token", %{"user_id" => "surv-1"}, System.system_time(:second) + 100)
      assert {:ok, _} = NexusSocket.Auth.Cache.lookup("crash-test-token")

      # Kill the Cache GenServer process
      Process.exit(cache_pid_before, :kill)
      Process.sleep(50)

      # Supervisor should have restarted Cache GenServer with a new PID
      cache_pid_after = Process.whereis(NexusSocket.Auth.Cache)
      assert is_pid(cache_pid_after)
      assert cache_pid_after != cache_pid_before
      assert Process.alive?(cache_pid_after)

      # Verify ETS table and cached token survived the crash via Heir pattern
      assert {:ok, claims} = NexusSocket.Auth.Cache.lookup("crash-test-token")
      assert claims["user_id"] == "surv-1"
    end

    test "spawns isolated connection processes under PartitionSupervisor" do
      # Spawning a task or child under NexusSocket.ConnectionSupervisor
      child_spec = {Task, fn ->
        receive do
          :ping -> :pong
        end
      end}

      assert {:ok, task_pid} =
               DynamicSupervisor.start_child(
                 {:via, PartitionSupervisor, {NexusSocket.ConnectionSupervisor, self()}},
                 child_spec
               )

      assert is_pid(task_pid)
      assert Process.alive?(task_pid)

      # Crashing the child task does not affect supervisor or application
      Process.exit(task_pid, :kill)
      Process.sleep(20)

      root_pid = Process.whereis(NexusSocket.Supervisor)
      assert Process.alive?(root_pid)
    end
  end
end
